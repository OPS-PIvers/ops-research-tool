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

// Single-flight guard for refreshContext. Page load fires getActiveProject +
// loadPageHighlights while a highlight fires another getActiveProject — without
// this, each would launch its own 3-call refresh against a (possibly cold) GAS
// instance, serializing server-side and compounding the cold-start latency that
// made the launcher feel dead. Concurrent callers now share one refresh.
let _ctxRefreshInFlight = null;
function refreshContextOnce_() {
  if (_ctxRefreshInFlight) return _ctxRefreshInFlight;
  _ctxRefreshInFlight = refreshContext().finally(() => { _ctxRefreshInFlight = null; });
  return _ctxRefreshInFlight;
}

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
          }))
          .concat(
            batch
              .filter((b) => b.kind === 'deleteSource')
              .map((b) => ({ kind: 'source', id: b.payload.sourceId }))
          );
        try {
          const resp = await apiPost({ projectId, sources, highlights, deletes });
          anyOnline = true;
          if (resp.ok) {
            await removeQueueItems(batch.map((b) => b.id));
            // Fold the synced batch into the local project snapshot so a page
            // revisit shows it at once (before the next server refresh).
            await applyBatchToProjectCache_(projectId, sources, highlights, deletes).catch(() => {});
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
          if (e && e.authRequired) {
            // The token can't be silently refreshed — the student must
            // reconnect from the toolbar popup (interactive sign-in can't run
            // from a background alarm). Leave the items queued AND un-penalized
            // (no markItemFailure / backoff) so a reconnect drains them at
            // once; this is an auth wall, not a flaky write.
            await setSyncStatus('needsAuth');
            return;
          }
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
  return msg.includes('failed to fetch') || msg.includes('fetch failed') ||
    msg.includes('network') || msg.includes('no token') ||
    msg.includes('aborted') || msg.includes('timeout');
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
    case 'enqueueSourcePatch':
      return enqueueSourcePatch_(msg.source);
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
      // Share the single-flight so a popup-open doesn't fire a second 3-call
      // refresh on top of one the sidebar/toolbar already kicked.
      return refreshContextOnce_();
    case 'signIn':
      return signInInteractive_();
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
      return loadPageHighlights_(msg.rawUrl, sender && sender.tab ? sender.tab.id : null);
    case 'previewCitation':
      return previewCitation_(msg.fields, msg.style);
    case 'deleteHighlight':
      return deleteHighlightRequest_(msg.highlightId, msg.sourceId, msg.cascadeSource);
    case 'deleteSource':
      return deleteSourceRequest_(msg.sourceId);
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
async function loadPageHighlights_(rawUrl, tabId) {
  if (!rawUrl) return { ok: false, error: 'rawUrl required' };
  // Resolve the project through getActiveProjectInfo (not the raw storage key):
  // on a fresh profile the sticky id is unset until that auto-pick runs, and the
  // page-load fetch used to race it, read null, and return an empty list that
  // never retried — one of the "my highlights didn't come back" causes.
  let projectId = null;
  try {
    const info = await getActiveProjectInfo();
    projectId = info && info.activeProjectId;
  } catch (e) {
    projectId = await getActiveProjectId();
  }
  if (!projectId) {
    console.log('[OPS] loadPageHighlights: no active project');
    return { ok: true, highlights: [], noProject: true };
  }
  const normalized = normalizeUrl(rawUrl);
  const pending = await pendingQueueForProject_(projectId);

  // Cache-first (stale-while-revalidate). The per-project snapshot answers
  // instantly, overlaid with anything still in the offline queue so work the
  // student captured seconds ago (not yet drained) is on the list too. A
  // background refresh then pushes the server truth to the tab.
  const cached = await getProjectDataCache_(projectId);
  if (cached) {
    const view = selectPageData_(overlayPendingOnData_(cached, pending, true), normalized);
    await seedPageSourceCache_(projectId, normalized, view.source);
    const age = Date.now() - (cached.fetchedAt || 0);
    if (age > PROJ_DATA_REFRESH_MIN_MS) {
      refreshProjectDataOnce_(projectId).then(async (fresh) => {
        const pending2 = await pendingQueueForProject_(projectId);
        const view2 = selectPageData_(overlayPendingOnData_(fresh, pending2, true), normalized);
        await seedPageSourceCache_(projectId, normalized, view2.source);
        pushPageUpdate_(tabId, { rawUrl, normalizedUrl: normalized, projectId, ...view2 });
      }).catch((e) => console.debug('[OPS] background project-data refresh failed:', e.message || e));
    }
    return { ok: true, fromCache: true, ...view };
  }

  // Cold: nothing cached for this project yet — block on one network call.
  try {
    const fresh = await refreshProjectDataOnce_(projectId);
    const view = selectPageData_(overlayPendingOnData_(fresh, pending, true), normalized);
    await seedPageSourceCache_(projectId, normalized, view.source);
    console.log('[OPS] loadPageHighlights (network):', {
      rawUrl, normalized,
      totalSources: fresh.sources.length,
      totalHighlights: fresh.highlights.length,
      matchingHighlights: view.highlights.length,
    });
    return { ok: true, ...view };
  } catch (e) {
    console.warn('[OPS] loadPageHighlights threw:', e);
    // Offline / backend down: still surface the not-yet-synced local work so
    // the panel isn't blank, and tell the caller to retry.
    const view = selectPageData_(overlayPendingOnData_({ sources: [], highlights: [] }, pending, true), normalized);
    return { ok: false, error: e.message || String(e), retryable: true, ...view };
  }
}

// ---------- per-project local data cache ----------

const PROJ_DATA_PREFIX = 'projData:';
// Don't re-hit the server for a project snapshot fetched this recently — a
// student reloading a page a few times in a row gets the cache each time.
const PROJ_DATA_REFRESH_MIN_MS = 15000;
const _projRefreshInFlight = new Map();

async function getProjectDataCache_(projectId) {
  const v = await getCache(PROJ_DATA_PREFIX + projectId);
  return v && Array.isArray(v.sources) && Array.isArray(v.highlights) ? v : null;
}

async function setProjectDataCache_(projectId, data) {
  await setCache(PROJ_DATA_PREFIX + projectId, data);
}

/** Single-flight per project: concurrent page loads share one server fetch. */
function refreshProjectDataOnce_(projectId) {
  if (_projRefreshInFlight.has(projectId)) return _projRefreshInFlight.get(projectId);
  const p = fetchProjectDataFromServer_(projectId).finally(() => _projRefreshInFlight.delete(projectId));
  _projRefreshInFlight.set(projectId, p);
  return p;
}

async function fetchProjectDataFromServer_(projectId) {
  let resp = await apiGet({ action: 'myProjectData', projectId });
  if (!resp || !resp.ok) {
    if (resp && /Unknown action/i.test(resp.error || '')) {
      // Older backend without the combined action — fall back to the pair.
      const [s, h] = await Promise.all([
        apiGet({ action: 'mySources', projectId }),
        apiGet({ action: 'myHighlights', projectId }),
      ]);
      if (!s.ok || !h.ok) throw new Error('backend returned not-ok');
      resp = { ok: true, sources: s.sources || [], highlights: h.highlights || [] };
    } else {
      throw new Error((resp && resp.error) || 'backend returned not-ok');
    }
  }
  const data = { sources: resp.sources || [], highlights: resp.highlights || [], fetchedAt: Date.now() };
  await setProjectDataCache_(projectId, data);
  return data;
}

/** Every queue item (any kind) targeting this project, oldest first. */
async function pendingQueueForProject_(projectId) {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all)
    .filter((k) => k.startsWith(QUEUE_PREFIX))
    .map((k) => all[k])
    .filter((q) => q && q.payload && q.payload.projectId === projectId)
    .sort((a, b) => (a.enqueuedAt || 0) - (b.enqueuedAt || 0));
}

/**
 * Apply queue items (source/highlight upserts + deletes) on top of a snapshot.
 * Pure. Returns a new { sources, highlights }. With markPending, upserted rows
 * carry `_pending: true` so the sidebar can show "saving…" for them. Object
 * JSON columns (citationFields / scrapedExtra) are stringified to match the
 * server's row shape, since the queue holds them as objects.
 */
function overlayPendingOnData_(data, queueItems, markPending) {
  const sources = (data.sources || []).map((s) => Object.assign({}, s));
  const highlights = (data.highlights || []).map((h) => Object.assign({}, h));
  const srcIdx = () => { const m = new Map(); sources.forEach((s, i) => m.set(s.sourceId, i)); return m; };
  const hlIdx = () => { const m = new Map(); highlights.forEach((h, i) => m.set(h.highlightId, i)); return m; };
  const jsonCol = (v) => {
    if (v === null || v === undefined) return '';
    return typeof v === 'string' ? v : JSON.stringify(v);
  };
  (queueItems || []).forEach((q) => {
    const p = q.payload || {};
    if (q.kind === 'source') {
      const m = srcIdx();
      const i = m.has(p.sourceId) ? m.get(p.sourceId) : -1;
      const row = Object.assign({}, i >= 0 ? sources[i] : {}, p);
      if ('citationFields' in p) row.citationFields = jsonCol(p.citationFields);
      else if (row.citationFields && typeof row.citationFields !== 'string') row.citationFields = jsonCol(row.citationFields);
      if ('scrapedExtra' in p) row.scrapedExtra = jsonCol(p.scrapedExtra);
      else if (row.scrapedExtra && typeof row.scrapedExtra !== 'string') row.scrapedExtra = jsonCol(row.scrapedExtra);
      if (!row.createdAt) row.createdAt = new Date(q.enqueuedAt || Date.now()).toISOString();
      if (markPending) row._pending = true;
      if (i >= 0) sources[i] = row; else sources.push(row);
    } else if (q.kind === 'highlight') {
      const m = hlIdx();
      const i = m.has(p.highlightId) ? m.get(p.highlightId) : -1;
      const row = Object.assign({}, i >= 0 ? highlights[i] : {}, p);
      if (markPending) row._pending = true;
      if (i >= 0) highlights[i] = row; else highlights.push(row);
    } else if (q.kind === 'deleteHighlight') {
      const m = hlIdx();
      if (m.has(p.highlightId)) highlights.splice(m.get(p.highlightId), 1);
      if (p.cascadeSource && p.sourceId && !highlights.some((h) => h.sourceId === p.sourceId)) {
        const sm = srcIdx();
        if (sm.has(p.sourceId)) sources.splice(sm.get(p.sourceId), 1);
      }
    } else if (q.kind === 'deleteSource') {
      const sm = srcIdx();
      if (sm.has(p.sourceId) && !highlights.some((h) => h.sourceId === p.sourceId)) {
        sources.splice(sm.get(p.sourceId), 1);
      }
    }
  });
  return { sources, highlights };
}

/**
 * Narrow a project snapshot to one page: sources for this page (oldest =
 * canonical, so duplicates converge) + their highlights. Pure. Matches on
 * sourcePageUrl, so rows saved under an older normalizer still match.
 */
function selectPageData_(data, normalized) {
  const matching = (data.sources || []).filter((s) => sourcePageUrl(s) === normalized);
  const ids = new Set(matching.map((s) => s.sourceId));
  const highlights = (data.highlights || []).filter((h) => ids.has(h.sourceId));
  let source = null;
  if (matching.length) {
    source = matching.slice().sort((a, b) =>
      String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    )[0];
  }
  return { highlights, sourceCount: ids.size, source };
}

/**
 * Cross-device / cache-cleared dedup: seed the per-page sourceId cache from
 * the matched source so a NEW highlight captured here merges into the existing
 * source instead of minting a duplicate row for the same URL.
 */
async function seedPageSourceCache_(projectId, normalized, source) {
  if (source && source.sourceId) await setCachedSourceId(projectId, normalized, source.sourceId);
}

/** Push a refreshed page view to the tab's content script (best-effort). */
function pushPageUpdate_(tabId, payload) {
  if (tabId === null || tabId === undefined) return;
  try {
    chrome.tabs.sendMessage(tabId, Object.assign({ type: 'pageHighlightsUpdated' }, payload)).catch(() => {});
  } catch (e) { /* tab gone */ }
}

/**
 * After a batch syncs, fold it into the local project snapshot so a page
 * revisit reflects it even before the next server refresh (and so the
 * 15s refresh floor never hides just-saved work).
 */
async function applyBatchToProjectCache_(projectId, sources, highlights, deletes) {
  const cached = await getProjectDataCache_(projectId);
  if (!cached) return;
  const items = []
    .concat((sources || []).map((p) => ({ kind: 'source', payload: p })))
    .concat((highlights || []).map((p) => ({ kind: 'highlight', payload: p })))
    .concat((deletes || []).map((d) => d.kind === 'highlight'
      ? { kind: 'deleteHighlight', payload: { highlightId: d.id, sourceId: d.sourceId, cascadeSource: d.cascadeSource } }
      : { kind: 'deleteSource', payload: { sourceId: d.id } }));
  const merged = overlayPendingOnData_(cached, items, false);
  await setProjectDataCache_(projectId, { sources: merged.sources, highlights: merged.highlights, fetchedAt: cached.fetchedAt });
}

/**
 * Proxy the read-only MLA preview to GAS. Content scripts can't call the API
 * directly (chrome.identity lives here). Returns { ok:false, error } on
 * network failure so the Source tab can fall back to "preview offline".
 */
async function previewCitation_(fields, style) {
  try {
    return await apiGet({ action: 'previewCitation', fields: JSON.stringify(fields || {}), style: style || 'mla' });
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
 * Persist a student's citation edits from the in-page Source tab. Sends a full
 * source upsert (scraped + citation fields) so no column blanks on the merge,
 * and routes through enqueueSourceUpsert_ so it coalesces with any pending
 * scrape re-assert for the same source.
 */
async function enqueueSourcePatch_(source) {
  const projectId = await getActiveProjectId();
  if (!projectId) throw new Error('No active project.');
  if (!source || !source.sourceId || !source.rawUrl) {
    throw new Error('source must have sourceId and rawUrl');
  }
  // Build the payload, omitting empty scraped* / scrapedExtra fields so a
  // Source-tab patch carrying '' for a scraped field cannot overwrite a
  // not-yet-synced scrape's real value on merge. Citation-owned fields are
  // always included (the Source tab always provides concrete values, and an
  // empty annotation is an intentional server-side clear).
  const patch = {
    sourceId: source.sourceId,
    projectId,
    normalizedUrl: source.normalizedUrl || normalizeUrl(source.rawUrl),
    rawUrl: source.rawUrl,
    accessDate: source.accessDate || new Date().toISOString(),
    sourceType: source.sourceType || '',
    citationFields: source.citationFields || null,
    primarySecondary: source.primarySecondary || 'unset',
    annotation: typeof source.annotation === 'string' ? source.annotation : '',
  };
  if (source.scrapedTitle)  patch.scrapedTitle  = source.scrapedTitle;
  if (source.scrapedSite)   patch.scrapedSite   = source.scrapedSite;
  if (source.scrapedDate)   patch.scrapedDate   = source.scrapedDate;
  if (source.scrapedAuthor) patch.scrapedAuthor = source.scrapedAuthor;
  if (source.scrapedExtra)  patch.scrapedExtra  = source.scrapedExtra;
  await enqueueSourceUpsert_(patch);
  return { ok: true };
}

/**
 * Enqueue a source upsert, collapsing any not-yet-synced source item for the
 * same sourceId first. Without this, every highlight on a page would queue an
 * identical source write; with it, repeated highlights coalesce to one pending
 * write that carries the freshest scrape data.
 */
async function enqueueSourceUpsert_(payload) {
  const all = await chrome.storage.local.get(null);
  const staleKeys = Object.keys(all).filter((k) =>
    k.startsWith(QUEUE_PREFIX) &&
    all[k] && all[k].kind === 'source' &&
    all[k].payload && all[k].payload.sourceId === payload.sourceId
  );
  // Merge any pending writes for this source, newest winning per key it
  // provides; keys it omits keep the prior pending value. Without this, a
  // scrape re-assert (no citation keys) would drop a not-yet-synced citation
  // edit, or vice-versa.
  //
  // Sort ascending by enqueuedAt (the stable creation timestamp on every item,
  // distinct from nextAttemptAt which mutates on backoff retries) so that when
  // two near-simultaneous enqueues leave 2 stale items, the fold is
  // deterministic: earlier payloads are applied first, later ones win per key.
  // The incoming `payload` is always folded last, so it always wins.
  staleKeys.sort((a, b) => (all[a].enqueuedAt || 0) - (all[b].enqueuedAt || 0));
  let merged = {};
  staleKeys.forEach((k) => { merged = Object.assign(merged, all[k].payload); });
  merged = Object.assign(merged, payload);
  if (staleKeys.length) await chrome.storage.local.remove(staleKeys);
  await enqueue('source', merged);
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

/**
 * Enqueue a standalone source deletion (the last-note "Delete source" toast).
 * Orphan-safe on the server. Also clears any pageSource cache entry pointing at
 * the deleted source so a later highlight on that page mints a fresh source
 * rather than reusing a server-deleted id.
 */
async function deleteSourceRequest_(sourceId) {
  const projectId = await getActiveProjectId();
  if (!projectId) throw new Error('No active project.');
  if (!sourceId) throw new Error('sourceId required');
  await enqueue('deleteSource', { projectId, sourceId });
  const all = await chrome.storage.local.get(null);
  const toRemove = [];
  for (const k of Object.keys(all)) {
    if (k.startsWith(PAGE_SOURCE_PREFIX) && all[k] === sourceId) toRemove.push(k);
  }
  if (toRemove.length) await chrome.storage.local.remove(toRemove);
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

/** Returns { activeProjectId, project, bundle, projects } using cache; refreshes if absent. */
async function getActiveProjectInfo() {
  let activeProjectId = await getActiveProjectId();
  let projects = (await getCache('cachedProjects')) || [];
  let bundles = (await getCache('cachedBundles')) || [];
  let project = projects.find((p) => p.projectId === activeProjectId) || null;

  // Stale-while-revalidate. The projects/bundles caches were historically only
  // warmed when the popup opened; the sidebar + toolbar now read context on every
  // page, so we keep refreshing — but the refresh must NOT sit on the hot path.
  //
  // "Usable" = we can answer right now without the network: a non-empty project
  // list, and either no active id yet (auto-pick below handles it) or an active
  // id that resolves to a project. Only a genuinely cold/unresolvable cache
  // BLOCKS on a refresh; a merely-stale-but-usable cache is served instantly and
  // refreshed in the BACKGROUND for next time. The TTL still lets a newly created
  // project reach the picker — just without freezing highlighting / the panel
  // behind a (possibly cold) GAS round-trip, which was the cold-start "dead
  // launcher" + "No active project" bug. Crucially this never returns
  // project:null when a usable cached project exists just because a refresh was
  // due or failed — that null is what the toolbar surfaced as "No active project"
  // while the sidebar still showed the (cached) one.
  const cachedAt = (await getCache('cachedContextAt')) || 0;
  const stale = (Date.now() - cachedAt) > CONFIG.PROJECTS_CACHE_TTL_MS;
  const usable = projects.length > 0 && (!activeProjectId || project);
  if (!usable) {
    try {
      await refreshContextOnce_();
      projects = (await getCache('cachedProjects')) || [];
      bundles = (await getCache('cachedBundles')) || [];
      project = projects.find((p) => p.projectId === activeProjectId) || null;
    } catch (e) {
      console.debug('[OPS] getActiveProjectInfo refresh failed (offline?):', e.message || e);
    }
  } else if (stale) {
    refreshContextOnce_().catch((e) => {
      console.debug('[OPS] background context refresh failed:', e.message || e);
    });
  }
  // Auto-pick the first project when none is active yet — OR when the sticky
  // activeProjectId is DANGLING (set, but no longer in the caller's project
  // list, e.g. the project was archived/recreated with a new id). Without the
  // dangling-id case, a stale sticky id strands the user on project:null forever
  // (the refresh above can't resolve an id the server no longer returns), which
  // reads as "No active project" in the toolbar while the sidebar dropdown still
  // shows a project — its <select> just defaults to the first option when none
  // is selected. Self-heal by repointing to the first available project and
  // persisting the correction (+ best-effort server sync so the Docs sidebar
  // matches). A single-project student then never has to choose, and a stale id
  // fixes itself on the next read.
  if (projects.length > 0 && (!activeProjectId || !project)) {
    activeProjectId = projects[0].projectId;
    await setActiveProjectId(activeProjectId);
    apiPost({ action: 'setActiveProject', projectId: activeProjectId }).catch(() => {});
    project = projects.find((p) => p.projectId === activeProjectId) || null;
  }
  const bundle = project ? bundles.find((b) => b.bundleId === project.bundleId) || null : null;
  return { ok: true, activeProjectId, project, bundle, projects, projectsKnown: projects.length > 0 };
}

/**
 * Interactive sign-in, started by the popup's "Sign in with Google" button.
 * Runs HERE rather than in the popup because the Google window takes focus and
 * Chrome closes the popup — any follow-up code in the popup would never run.
 * The worker outlives the popup, so it can finish the job: mint the token,
 * re-warm identity/projects, and drain whatever queued up while signed out.
 * Background drains still never call this (no user present to sign in).
 */
async function signInInteractive_() {
  await clearAllCachedTokens();
  try {
    await getAuthTokenAsync(true);
  } catch (e) {
    await setSyncStatus('needsAuth');
    return { ok: false, error: e.message || String(e) };
  }
  let me = null;
  try {
    // Not the single-flight: one already in flight was started with the dead
    // token and would hand back its auth failure.
    const r = await refreshContext();
    me = r && r.me;
  } catch (e) {
    // Got a Google token but the backend still bounced it — still signed out
    // as far as saving goes.
    if (e && e.authRequired) {
      await setSyncStatus('needsAuth');
      return { ok: false, error: e.message || String(e) };
    }
  }
  await setSyncStatus('idle');
  drain().catch(() => {});
  return { ok: true, me };
}

/**
 * The first time the backend recognizes this browser's user (on the roster or
 * staff) — a Sign in click or a silent token — switch the extension on. Only when the switch has
 * NEVER been set: a student who turned it off stays off. Keeps a force-install
 * dormant until someone actually signs in (the v0.1.2 default-off intent).
 */
async function autoEnableOnFirstSignIn_(me) {
  // Only someone the tool actually knows — a rostered student or staff. A
  // district account with no roster row would just get a toolbar on every
  // page that can only say "No active project". It turns on once they're added.
  if (!me || !me.ok || !me.actor || !(me.roster || me.staff)) return;
  const { extensionEnabled } = await chrome.storage.local.get('extensionEnabled');
  if (extensionEnabled === undefined) await chrome.storage.local.set({ extensionEnabled: true });
}

/** Refresh roster + projects + bundles caches from GAS. Called by popup on open. */
async function refreshContext() {
  // One combined round-trip (the backend's `bootstrap` action). Each GAS call
  // can cost 1–3s cold, so collapsing the trio is the single biggest win for a
  // fresh profile. Falls back to the three legacy actions against an older
  // deployment that doesn't know `bootstrap`.
  let boot = null;
  try {
    boot = await apiGet({ action: 'bootstrap' });
  } catch (e) {
    throw e;   // network / auth — same failure surface as before
  }
  if (boot && boot.ok && Array.isArray(boot.projects)) {
    await autoEnableOnFirstSignIn_(boot.me);
    await setCache('cachedMe', boot.me);
    await setCache('cachedProjects', boot.projects);
    await setCache('cachedContextAt', Date.now());
    if (Array.isArray(boot.bundles)) await setCache('cachedBundles', boot.bundles);
    return {
      ok: true,
      me: boot.me,
      projects: { ok: true, projects: boot.projects },
      bundles: { ok: true, bundles: boot.bundles || [] },
    };
  }
  const [me, projects, bundles] = await Promise.all([
    apiGet({ action: 'me' }),
    apiGet({ action: 'projects' }),
    apiGet({ action: 'bundles' }),
  ]);
  if (me.ok) {
    await autoEnableOnFirstSignIn_(me);
    await setCache('cachedMe', me);
  }
  if (projects.ok) {
    await setCache('cachedProjects', projects.projects);
    // Stamp freshness only when the projects list actually updated, so a failed
    // (e.g. AUTH_REQUIRED) fetch leaves the cache stale and keeps retrying.
    await setCache('cachedContextAt', Date.now());
  }
  if (bundles.ok) await setCache('cachedBundles', bundles.bundles);
  return { ok: true, me, projects, bundles };
}
