/**
 * Service worker. Runs in its own context (no DOM). Responsibilities:
 *
 *   1. Drain the offline queue to the GAS Web App on a timer + on enqueue.
 *   2. Mediate findSource / sourceId allocation for content scripts so the
 *      "one source per normalized URL" contract holds across same-page reloads.
 *   3. Provide message-handler APIs that content scripts and the popup call
 *      via chrome.runtime.sendMessage (content scripts cannot use
 *      chrome.identity, so all auth-bearing work funnels through here).
 *
 * The drain runs at most one at a time (drainLock).
 */

importScripts(
  'config.js',
  'shared/ids.js',
  'shared/url.js',
  'shared/storage.js',
  'shared/api.js'
);

const DRAIN_ALARM = 'opsResearch.drain';
let drainLock = false;

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(DRAIN_ALARM, { periodInMinutes: CONFIG.DRAIN_PERIOD_MINUTES });
  console.log('OPS Research Tool: installed; drain alarm registered.');
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(DRAIN_ALARM, { periodInMinutes: CONFIG.DRAIN_PERIOD_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DRAIN_ALARM) drain().catch((e) => console.warn('Drain failed:', e));
});

// Kick a drain whenever new queue items appear.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const newQueueItem = Object.keys(changes).some(
    (k) => k.startsWith(QUEUE_PREFIX) && changes[k].newValue && !changes[k].oldValue
  );
  if (newQueueItem) drain().catch((e) => console.warn('Drain failed:', e));
});

async function drain() {
  if (drainLock) return;
  drainLock = true;
  try {
    const now = Date.now();
    const queue = (await getQueueSnapshot()).filter((q) => q.nextAttemptAt <= now);
    if (queue.length === 0) {
      await setSyncStatus('idle');
      return;
    }
    await setSyncStatus('syncing');

    // Group by projectId so each POST is one project.
    const byProject = new Map();
    queue.forEach((q) => {
      const pid = q.payload.projectId;
      if (!pid) return; // malformed; skip
      if (!byProject.has(pid)) byProject.set(pid, []);
      byProject.get(pid).push(q);
    });

    let anyOnline = false;
    let anyFailed = false;

    for (const [projectId, items] of byProject) {
      for (let i = 0; i < items.length; i += CONFIG.MAX_BATCH_SIZE) {
        const batch = items.slice(i, i + CONFIG.MAX_BATCH_SIZE);
        const sources = batch.filter((b) => b.kind === 'source').map((b) => b.payload);
        const highlights = batch.filter((b) => b.kind === 'highlight').map((b) => b.payload);
        const deletes = batch
          .filter((b) => b.kind === 'deleteHighlight')
          .map((b) => ({
            kind: 'highlight',
            id: b.payload.highlightId,
            cascadeSource: b.payload.cascadeSource,
            sourceId: b.payload.sourceId,
          }));
        try {
          const resp = await apiPost({ projectId, sources, highlights, deletes });
          anyOnline = true;
          if (resp.ok) {
            await removeQueueItems(batch.map((b) => b.id));
          } else {
            // Backend rejected something — surface per-item errors.
            const erroredIds = new Set((resp.errors || []).map((e) => e.id));
            const successes = batch.filter((b) =>
              !erroredIds.has(b.payload.sourceId) && !erroredIds.has(b.payload.highlightId)
            );
            await removeQueueItems(successes.map((b) => b.id));
            for (const b of batch) {
              if (erroredIds.has(b.payload.sourceId) || erroredIds.has(b.payload.highlightId)) {
                await markItemFailure(b.id, 'backend rejected: ' + (resp.errors || []).map((e) => e.error).join('; '));
                anyFailed = true;
              }
            }
          }
        } catch (e) {
          anyFailed = true;
          for (const b of batch) await markItemFailure(b.id, e.message || String(e));
          // Network error — stop trying further projects this drain cycle.
          if (isNetworkError(e)) {
            await setSyncStatus('offline');
            return;
          }
        }
      }
    }

    await setSyncStatus(anyFailed ? 'error' : (anyOnline ? 'idle' : 'idle'));
  } finally {
    drainLock = false;
  }
}

function isNetworkError(e) {
  const msg = String(e && e.message || e).toLowerCase();
  return msg.includes('failed to fetch') || msg.includes('network') || msg.includes('no token');
}

// ---------- message handlers ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then((resp) => sendResponse(resp)).catch((e) => {
    console.warn('handleMessage error:', e);
    sendResponse({ ok: false, error: e.message || String(e) });
  });
  return true; // keep channel open for async response
});

async function handleMessage(msg, sender) {
  switch (msg.type) {
    case 'getOrCreateSourceId':
      return getOrCreateSourceId(msg.rawUrl, msg.scrape || {});
    case 'enqueueHighlight':
      return enqueueHighlight(msg.highlight);
    case 'getActiveProject':
      return getActiveProjectInfo();
    case 'setActiveProject':
      await setActiveProjectId(msg.projectId);
      // Best-effort sync to the server so the Docs sidebar (Phase 3) sees
      // the same active project. Failures are non-fatal — local storage is
      // still the canonical extension-side value.
      apiPost({ action: 'setActiveProject', projectId: msg.projectId || '' }).catch((e) => {
        console.debug('[OPS] setActiveProject server sync failed:', e.message || e);
      });
      return { ok: true };
    case 'refreshContext':
      return refreshContext();
    case 'getSyncStatus':
      return getSyncStatus();
    case 'forceDrain':
      drain().catch(() => {});
      return { ok: true };
    case 'fetchPdf':
      return fetchPdfAsBase64_(msg.url);
    case 'openPdfPanel':
      return openPdfPanel_(msg.url);
    case 'loadPageHighlights':
      return loadPageHighlights_(msg.rawUrl);
    case 'deleteHighlight':
      return deleteHighlightRequest_(msg.highlightId, msg.sourceId, msg.cascadeSource);
    default:
      return { ok: false, error: 'unknown message type: ' + msg.type };
  }
}

/**
 * Fetch a PDF and return its bytes base64-encoded so chrome.runtime.sendMessage
 * (JSON-only) can ferry them to the panel. Service worker has the
 * host_permissions to bypass CORS.
 */
async function fetchPdfAsBase64_(url) {
  if (!url) return { ok: false, error: 'url required' };
  try {
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) return { ok: false, error: 'HTTP ' + resp.status };
    const buf = await resp.arrayBuffer();
    return { ok: true, base64: arrayBufferToBase64_(buf), byteLength: buf.byteLength };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function arrayBufferToBase64_(buf) {
  // Chunked to avoid stack overflow on very large PDFs.
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Sidebar persistence after page reload. Returns highlights whose source has
 * the same normalized URL as the calling page, so the in-page sidebar can
 * show the student's saved work for this page even after a refresh.
 * (On-page colored marks deliberately do NOT come back — re-anchoring is
 * out of scope per build plan §2. The sidebar is a record, not a re-render.)
 */
async function loadPageHighlights_(rawUrl) {
  if (!rawUrl) return { ok: false, error: 'rawUrl required' };
  const projectId = await getActiveProjectId();
  if (!projectId) {
    console.log('[OPS] loadPageHighlights: no active project');
    return { ok: true, highlights: [] };
  }
  const normalized = normalizeUrl(rawUrl);
  try {
    const [sourcesResp, highlightsResp] = await Promise.all([
      apiGet({ action: 'mySources', projectId }),
      apiGet({ action: 'myHighlights', projectId }),
    ]);
    if (!sourcesResp.ok || !highlightsResp.ok) {
      console.warn('[OPS] loadPageHighlights backend not-ok:', { sourcesResp, highlightsResp });
      return { ok: false, error: 'backend returned not-ok' };
    }
    const allSources = sourcesResp.sources || [];
    const allHighlights = highlightsResp.highlights || [];
    const matching = allSources.filter((s) => s.normalizedUrl === normalized);
    const matchingSourceIds = new Set(matching.map((s) => s.sourceId));
    const highlights = allHighlights.filter((h) => matchingSourceIds.has(h.sourceId));

    // Cross-device / cache-cleared dedup: this device may not have a local
    // pageSource cache entry for this URL (the cache is per-device). Seed it
    // from the server match so a NEW highlight captured here merges into the
    // existing source instead of minting a duplicate source row for the same
    // URL. Reuses this fetch — no extra round-trip, offline-safe. When dups
    // already exist, pick the oldest as canonical so everything converges on
    // one source over time.
    if (matching.length) {
      const canonical = matching.slice().sort((a, b) =>
        String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
      )[0];
      if (canonical && canonical.sourceId) {
        await setCachedSourceId(projectId, normalized, canonical.sourceId);
      }
    }
    console.log('[OPS] loadPageHighlights:', {
      rawUrl,
      normalized,
      totalSources: allSources.length,
      totalHighlights: allHighlights.length,
      matchingSources: matching.length,
      matchingHighlights: highlights.length,
      sourceNormalizedUrls: allSources.map((s) => s.normalizedUrl).slice(0, 5),
    });
    return { ok: true, highlights, sourceCount: matchingSourceIds.size };
  } catch (e) {
    console.warn('[OPS] loadPageHighlights threw:', e);
    return { ok: false, error: e.message || String(e) };
  }
}

async function openPdfPanel_(url) {
  if (!url) return { ok: false, error: 'url required' };
  const panelUrl = chrome.runtime.getURL('pdf/panel.html') + '?src=' + encodeURIComponent(url);
  const tab = await chrome.tabs.create({ url: panelUrl });
  return { ok: true, tabId: tab.id };
}

/**
 * Source dedup. Content script sends rawUrl + scrape; we return a sourceId.
 * Order: local cache → mint new. NO remote round-trip here, so the call stays
 * instant and works offline. The cache is seeded two ways: by this function on
 * first capture, and by loadPageHighlights_ from the server match on page
 * visit — the latter is what lets a different device (or a cache-cleared one)
 * reuse the existing source instead of duplicating it.
 *
 * Residual dup window: if two devices BOTH first-highlight the same URL before
 * either has loaded the page's server highlights, each mints its own sourceId
 * and the project ends up with two source rows for that URL. Narrow and
 * accepted per build plan §2; they converge on the oldest source on the next
 * visit, and manual cleanup is possible in the sidebar.
 */
async function getOrCreateSourceId(rawUrl, scrape) {
  const projectId = await getActiveProjectId();
  if (!projectId) throw new Error('No active project — pick one from the extension toolbar.');
  const normalized = normalizeUrl(rawUrl);

  // The cache gives a STABLE sourceId per page so multiple highlights group
  // under one source. But it can outlive the source row it points at: deleting
  // a source from the Docs sidebar is purely server-side and never clears this
  // (persistent) cache. So we no longer trust a cache hit to mean "the source
  // row exists" — we ALWAYS (re)assert the source row below. upsertSource_ is
  // idempotent and preserves any sidebar-owned citation work on an existing
  // row, so this is a cheap no-op when the source is already present, and a
  // self-heal when it was deleted (the orphaned highlights then reattach).
  const cached = await getCachedSourceId(projectId, normalized);
  const sourceId = cached || newUuid();
  if (!cached) await setCachedSourceId(projectId, normalized, sourceId);

  await enqueueSourceUpsert_({
    sourceId,
    projectId,
    normalizedUrl: normalized,
    rawUrl,
    accessDate: new Date().toISOString(),
    scrapedTitle: scrape.title || '',
    scrapedSite: scrape.site || '',
    scrapedDate: scrape.date || '',
    scrapedAuthor: scrape.author || '',
    scrapedExtra: pickScrapedExtra_(scrape),
  });
  return { ok: true, sourceId, normalizedUrl: normalized, source: cached ? 'cache' : 'new' };
}

/**
 * Enqueue a source upsert, collapsing any not-yet-synced source item for the
 * same sourceId first. Without this, every highlight on a page would queue an
 * identical source write; with it, repeated highlights coalesce to one pending
 * write that carries the freshest scrape data.
 */
async function enqueueSourceUpsert_(payload) {
  const all = await chrome.storage.local.get(null);
  const stale = Object.keys(all).filter((k) =>
    k.startsWith(QUEUE_PREFIX) &&
    all[k] && all[k].kind === 'source' &&
    all[k].payload && all[k].payload.sourceId === payload.sourceId
  );
  if (stale.length) await chrome.storage.local.remove(stale);
  await enqueue('source', payload);
}

// The richer scrape fields beyond the four discrete scraped* columns. Only
// non-empty values are kept; returns null when nothing extra was found so the
// scrapedExtra column stays blank rather than holding an empty {}.
function pickScrapedExtra_(scrape) {
  const extra = {};
  ['publication', 'publisher', 'volume', 'issue', 'pages', 'sourceType'].forEach((k) => {
    if (scrape[k]) extra[k] = scrape[k];
  });
  return Object.keys(extra).length ? extra : null;
}

/**
 * Enqueue a highlight deletion + (optionally) cascade-delete the source if
 * this was its last referencing highlight. Also clears any local
 * pageSource:<projectId>:<normalizedUrl> cache entry whose value is the
 * deleted sourceId, so a subsequent highlight on the same page mints a
 * fresh source rather than reusing an ID that the server has already
 * cascade-deleted.
 */
async function deleteHighlightRequest_(highlightId, sourceId, cascadeSource) {
  const projectId = await getActiveProjectId();
  if (!projectId) throw new Error('No active project.');
  if (!highlightId) throw new Error('highlightId required');
  await enqueue('deleteHighlight', {
    projectId,
    highlightId,
    sourceId: sourceId || '',
    cascadeSource: !!cascadeSource,
  });
  if (cascadeSource && sourceId) {
    const all = await chrome.storage.local.get(null);
    const toRemove = [];
    for (const k of Object.keys(all)) {
      if (k.startsWith(PAGE_SOURCE_PREFIX) && all[k] === sourceId) toRemove.push(k);
    }
    if (toRemove.length) await chrome.storage.local.remove(toRemove);
  }
  return { ok: true };
}

async function enqueueHighlight(h) {
  const projectId = await getActiveProjectId();
  if (!projectId) throw new Error('No active project.');
  if (!h.sourceId || !h.highlightedText) {
    throw new Error('highlight must have sourceId and highlightedText');
  }
  // primaryCategory may be empty for note-only highlights — student can
  // categorize later from the sidebar.
  const highlightId = h.highlightId || newUuid();
  await enqueue('highlight', {
    highlightId,
    sourceId: h.sourceId,
    projectId,
    primaryCategory: h.primaryCategory || '',
    secondaryCategory: h.secondaryCategory || '',
    highlightedText: h.highlightedText,
    note: h.note || '',
    createdAt: new Date().toISOString(),
  });
  return { ok: true, highlightId };
}

/** Returns { activeProjectId, project, bundle } using cache; refreshes if absent. */
async function getActiveProjectInfo() {
  const activeProjectId = await getActiveProjectId();
  const projects = (await getCache('cachedProjects')) || [];
  const bundles = (await getCache('cachedBundles')) || [];
  const project = projects.find((p) => p.projectId === activeProjectId) || null;
  const bundle = project ? bundles.find((b) => b.bundleId === project.bundleId) || null : null;
  return { ok: true, activeProjectId, project, bundle, projectsKnown: projects.length > 0 };
}

/** Refresh roster + projects + bundles caches from GAS. Called by popup on open. */
async function refreshContext() {
  const [me, projects, bundles] = await Promise.all([
    apiGet({ action: 'me' }),
    apiGet({ action: 'projects' }),
    apiGet({ action: 'bundles' }),
  ]);
  if (me.ok) await setCache('cachedMe', me);
  if (projects.ok) await setCache('cachedProjects', projects.projects);
  if (bundles.ok) await setCache('cachedBundles', bundles.bundles);
  return { ok: true, me, projects, bundles };
}
