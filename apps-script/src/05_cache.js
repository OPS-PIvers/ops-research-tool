/**
 * Cross-request read cache (CacheService) + per-execution memo.
 *
 * Why: every request used to re-open the same three registry workbooks
 * (Projects, Bundles, Roster) and, for a student, re-walk Drive to find their
 * Sheet — 4–8 slow service calls before any real work. Registry data changes
 * rarely (a teacher action), so it's cached here for a short TTL and
 * explicitly dropped by every write path that touches it.
 *
 * Correctness model:
 *   - Cached values are JSON round-tripped: Sheets `Date` cells come back as
 *     ISO strings. Every consumer already coerces with String()/new Date(), and
 *     google.script.run can't carry a Date anyway (CLAUDE.md §5), so this is
 *     strictly safer.
 *   - Values > ~90KB are chunked across several keys (CacheService caps a value
 *     at 100KB) so a large roster still caches.
 *   - Writers call the matching `invalidate*_` helper; a missed invalidation
 *     degrades to "stale for ≤ TTL", never to a wrong write (the per-student
 *     Sheet resolution is additionally versioned — see sheetRefVersion_).
 *   - Any CacheService failure falls through to the live read.
 */

var OPS_CACHE_NS = 'ops:v1:';
var CACHE_CHUNK_BYTES = 90000;

// Per-execution memo. A GAS execution gets a fresh global scope, so this is
// naturally request-scoped: the same key is computed at most once per request.
var _opsExecMemo = {};

function opsCache_() {
  try { return CacheService.getScriptCache(); } catch (e) { return null; }
}

/**
 * Read-through cache. `compute` runs only on a miss. Returns the value (JSON
 * round-tripped on a hit — see file header).
 */
function cachedJson_(key, ttlSec, compute) {
  const k = OPS_CACHE_NS + key;
  if (Object.prototype.hasOwnProperty.call(_opsExecMemo, k)) return _opsExecMemo[k];
  const hit = cacheReadRaw_(k);
  if (hit !== null) {
    try {
      const v = JSON.parse(hit);
      _opsExecMemo[k] = v;
      return v;
    } catch (e) { /* corrupt — recompute */ }
  }
  const value = compute();
  _opsExecMemo[k] = value;
  cacheWriteRaw_(k, value, ttlSec);
  return value;
}

/** Drop one or more keys from both the memo and CacheService. */
function cacheDrop_(keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  const cache = opsCache_();
  list.forEach((key) => {
    const k = OPS_CACHE_NS + key;
    delete _opsExecMemo[k];
    if (!cache) return;
    try {
      const head = cache.get(k);
      if (head && head.indexOf('__chunks:') === 0) {
        const n = parseInt(head.slice('__chunks:'.length), 10) || 0;
        const parts = [];
        for (let i = 0; i < n; i++) parts.push(k + ':' + i);
        cache.removeAll(parts);
      }
      cache.remove(k);
    } catch (e) { /* best-effort */ }
  });
}

function cacheReadRaw_(k) {
  const cache = opsCache_();
  if (!cache) return null;
  try {
    const head = cache.get(k);
    if (head === null || head === undefined) return null;
    if (head.indexOf('__chunks:') !== 0) return head;
    const n = parseInt(head.slice('__chunks:'.length), 10) || 0;
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(k + ':' + i);
    const got = cache.getAll(keys);
    let out = '';
    for (let i = 0; i < n; i++) {
      const part = got[keys[i]];
      if (part === null || part === undefined) return null;   // a chunk expired — treat as miss
      out += part;
    }
    return out;
  } catch (e) {
    return null;
  }
}

function cacheWriteRaw_(k, value, ttlSec) {
  const cache = opsCache_();
  if (!cache) return;
  try {
    const s = JSON.stringify(value === undefined ? null : value);
    // If the previous value was chunked, clear its chunks so a now-smaller
    // value doesn't leave orphans behind (they'd only expire by TTL).
    const prevHead = cache.get(k);
    if (prevHead && prevHead.indexOf('__chunks:') === 0) {
      const n = parseInt(prevHead.slice('__chunks:'.length), 10) || 0;
      const old = [];
      for (let i = 0; i < n; i++) old.push(k + ':' + i);
      if (old.length) cache.removeAll(old);
    }
    if (s.length <= CACHE_CHUNK_BYTES) { cache.put(k, s, ttlSec); return; }
    const parts = {};
    let n = 0;
    for (let i = 0; i < s.length; i += CACHE_CHUNK_BYTES) {
      parts[k + ':' + n] = s.slice(i, i + CACHE_CHUNK_BYTES);
      n++;
    }
    // Chunks first, head last — a reader that sees the head can rely on the
    // chunks existing (a chunk expiring first just reads as a miss).
    cache.putAll(parts, ttlSec);
    cache.put(k, '__chunks:' + n, ttlSec);
  } catch (e) { /* value too large or service hiccup — skip caching */ }
}

// ---------------------------------------------------------------------
// Versioned namespace for per-(student, project) Sheet resolution.
//
// Sheet ids only change via console actions (group merge/move/disband/add,
// admin email change, sample-data teardown). Those bump a single version
// stamp instead of enumerating keys, so every cached resolution invalidates
// at once. Reads pay one tiny cache get for the stamp.
// ---------------------------------------------------------------------

var SHEET_REF_VERSION_KEY = 'sheetref:ver';
var SHEET_REF_TTL_SEC = 21600;   // 6h — the version stamp is the real invalidation

function sheetRefVersion_() {
  const k = OPS_CACHE_NS + SHEET_REF_VERSION_KEY;
  if (Object.prototype.hasOwnProperty.call(_opsExecMemo, k)) return _opsExecMemo[k];
  let v = '0';
  const cache = opsCache_();
  if (cache) {
    try { v = cache.get(k) || '0'; } catch (e) { v = '0'; }
  }
  _opsExecMemo[k] = v;
  return v;
}

/** Invalidate every cached Sheet resolution + group listing at once. */
function bumpSheetRefVersion_() {
  const k = OPS_CACHE_NS + SHEET_REF_VERSION_KEY;
  const v = String(Date.now());
  _opsExecMemo[k] = v;
  const cache = opsCache_();
  if (cache) { try { cache.put(k, v, SHEET_REF_TTL_SEC); } catch (e) { /* best-effort */ } }
  // Anything memoized under the old version in THIS execution is now stale too.
  Object.keys(_opsExecMemo).forEach((mk) => {
    if (mk.indexOf(OPS_CACHE_NS + 'sheet:') === 0 || mk.indexOf(OPS_CACHE_NS + 'groups:') === 0) {
      delete _opsExecMemo[mk];
    }
  });
}

function sheetRefKey_(projectId, email) {
  return 'sheet:' + sheetRefVersion_() + ':' + String(projectId) + ':' + String(email || '').toLowerCase();
}

function groupsListKey_(projectId) {
  return 'groups:' + sheetRefVersion_() + ':' + String(projectId);
}

/** Cached { id, kind } for a (student, project) Sheet, or null. */
function getCachedSheetRef_(projectId, email) {
  const k = OPS_CACHE_NS + sheetRefKey_(projectId, email);
  if (Object.prototype.hasOwnProperty.call(_opsExecMemo, k)) return _opsExecMemo[k];
  const raw = cacheReadRaw_(k);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    _opsExecMemo[k] = v;
    return v;
  } catch (e) { return null; }
}

/** Remember a resolved (student, project) → Sheet id. Best-effort. */
function putCachedSheetRef_(projectId, email, ref) {
  if (!ref || !ref.id) return;
  const k = OPS_CACHE_NS + sheetRefKey_(projectId, email);
  _opsExecMemo[k] = ref;
  cacheWriteRaw_(k, ref, SHEET_REF_TTL_SEC);
}

// ---------------------------------------------------------------------
// Named invalidators — call from every write path that touches the data.
// ---------------------------------------------------------------------

function invalidateProjectsCache_() { cacheDrop_('projects'); }
function invalidateBundlesCache_()  { cacheDrop_('bundles'); }
function invalidateStaffCache_()    { cacheDrop_('staff'); }
function invalidateRosterCache_()   { cacheDrop_('roster'); }
function invalidateManifestCache_(projectId) { cacheDrop_('manifest:' + String(projectId)); }
function invalidateAuditCache_(projectId) { cacheDrop_('audit:unarchive:' + String(projectId)); }
function invalidateSheetRefCache_(projectId, email) { cacheDrop_(sheetRefKey_(projectId, email)); }

/**
 * Editor-callable: flush every OPS cache entry. Use after a manual Sheet edit
 * (e.g. hand-editing the roster or a registry row) so it shows up at once
 * instead of after the TTL. Safe any time — the next read recomputes.
 */
function devFlushOpsCache() {
  cacheDrop_(['projects', 'bundles', 'staff', 'roster']);
  bumpSheetRefVersion_();
  _opsExecMemo = {};
  console.log('OPS cache flushed (projects/bundles/staff/roster + sheet-ref version bumped).');
  return { ok: true };
}
