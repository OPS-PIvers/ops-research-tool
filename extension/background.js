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
        try {
          const resp = await apiPost({ projectId, sources, highlights });
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
  if (!projectId) return { ok: true, highlights: [] };
  const normalized = normalizeUrl(rawUrl);
  try {
    const [sourcesResp, highlightsResp] = await Promise.all([
      apiGet({ action: 'mySources', projectId }),
      apiGet({ action: 'myHighlights', projectId }),
    ]);
    if (!sourcesResp.ok || !highlightsResp.ok) {
      return { ok: false, error: 'backend returned not-ok' };
    }
    const matchingSourceIds = new Set(
      (sourcesResp.sources || [])
        .filter((s) => s.normalizedUrl === normalized)
        .map((s) => s.sourceId)
    );
    const highlights = (highlightsResp.highlights || []).filter((h) => matchingSourceIds.has(h.sourceId));
    return { ok: true, highlights, sourceCount: matchingSourceIds.size };
  } catch (e) {
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
 * Order: in-session local cache → mint new + enqueue. NO remote round-trip,
 * so the call is instant.
 *
 * The cost: if two devices first-highlight the same page in parallel, each
 * mints its own sourceId and the project ends up with two source rows for
 * the same normalized URL. Acceptable per build plan §2 ("Backend writes
 * are idempotent" / "data created offline … is stranded" was the worse case
 * already accepted; cross-device dup is a milder version). Manual cleanup
 * possible in the sidebar later.
 */
async function getOrCreateSourceId(rawUrl, scrape) {
  const projectId = await getActiveProjectId();
  if (!projectId) throw new Error('No active project — pick one from the extension toolbar.');
  const normalized = normalizeUrl(rawUrl);

  const cached = await getCachedSourceId(projectId, normalized);
  if (cached) return { ok: true, sourceId: cached, normalizedUrl: normalized, source: 'cache' };

  const sourceId = newUuid();
  await setCachedSourceId(projectId, normalized, sourceId);
  await enqueue('source', {
    sourceId,
    projectId,
    normalizedUrl: normalized,
    rawUrl,
    accessDate: new Date().toISOString(),
    scrapedTitle: scrape.title || '',
    scrapedSite: scrape.site || '',
    scrapedDate: scrape.date || '',
    scrapedAuthor: scrape.author || '',
  });
  return { ok: true, sourceId, normalizedUrl: normalized, source: 'new' };
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
