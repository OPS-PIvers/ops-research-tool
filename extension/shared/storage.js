/**
 * chrome.storage.local wrapper — the offline buffer.
 *
 * Invariant from build plan §2: every highlight writes here BEFORE any network
 * call. The student feels saved instantly even when offline.
 *
 * Key layout:
 *   q:<uuid>                          Pending queue item.
 *                                     { kind, payload, attempts, nextAttemptAt, lastError }
 *                                     kind is 'source' | 'highlight'.
 *   pageSource:<projectId>:<normUrl>  Cached sourceId for a page so multiple
 *                                     highlights on one page attach to one source.
 *   activeProjectId                   Sticky project selection (survives restart).
 *   syncStatus                        'idle' | 'syncing' | 'error' | 'offline'
 *   lastSyncAt                        ISO timestamp.
 *   cachedProjects                    Last successful 'projects' response.
 *   cachedBundles                     Last successful 'bundles' response.
 *   cachedMe                          Last successful 'me' response.
 */

const QUEUE_PREFIX = 'q:';
const PAGE_SOURCE_PREFIX = 'pageSource:';

async function enqueue(kind, payload) {
  const id = newUuid();
  const item = {
    id,
    kind,
    payload,
    attempts: 0,
    enqueuedAt: Date.now(),
    nextAttemptAt: Date.now(),
    lastError: '',
  };
  await chrome.storage.local.set({ [QUEUE_PREFIX + id]: item });
  return id;
}

async function getQueueSnapshot() {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all)
    .filter((k) => k.startsWith(QUEUE_PREFIX))
    .map((k) => all[k])
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt);
}

async function removeQueueItems(ids) {
  if (!ids || ids.length === 0) return;
  await chrome.storage.local.remove(ids.map((id) => QUEUE_PREFIX + id));
}

async function markItemFailure(id, errorMsg) {
  const key = QUEUE_PREFIX + id;
  const got = await chrome.storage.local.get(key);
  const item = got[key];
  if (!item) return;
  item.attempts += 1;
  item.lastError = String(errorMsg).slice(0, 500);
  // Exponential backoff: 5s, 10s, 20s, 40s, ..., capped.
  const delay = Math.min(5000 * Math.pow(2, item.attempts - 1), CONFIG.MAX_BACKOFF_MS);
  item.nextAttemptAt = Date.now() + delay;
  await chrome.storage.local.set({ [key]: item });
}

async function getCachedSourceId(projectId, normalizedUrl) {
  const key = PAGE_SOURCE_PREFIX + projectId + ':' + normalizedUrl;
  const got = await chrome.storage.local.get(key);
  return got[key] || null;
}

async function setCachedSourceId(projectId, normalizedUrl, sourceId) {
  const key = PAGE_SOURCE_PREFIX + projectId + ':' + normalizedUrl;
  await chrome.storage.local.set({ [key]: sourceId });
}

async function getActiveProjectId() {
  const got = await chrome.storage.local.get('activeProjectId');
  return got.activeProjectId || null;
}

async function setActiveProjectId(projectId) {
  await chrome.storage.local.set({ activeProjectId: projectId });
}

async function getSyncStatus() {
  const got = await chrome.storage.local.get(['syncStatus', 'lastSyncAt']);
  return {
    status: got.syncStatus || 'idle',
    lastSyncAt: got.lastSyncAt || null,
  };
}

async function setSyncStatus(status) {
  await chrome.storage.local.set({
    syncStatus: status,
    lastSyncAt: new Date().toISOString(),
  });
}

async function setCache(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

async function getCache(key) {
  const got = await chrome.storage.local.get(key);
  return got[key] || null;
}

if (typeof self !== 'undefined') {
  Object.assign(self, {
    enqueue, getQueueSnapshot, removeQueueItems, markItemFailure,
    getCachedSourceId, setCachedSourceId,
    getActiveProjectId, setActiveProjectId,
    getSyncStatus, setSyncStatus,
    setCache, getCache,
    QUEUE_PREFIX, PAGE_SOURCE_PREFIX,
  });
}
