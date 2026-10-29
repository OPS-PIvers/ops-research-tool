/** Small generic helpers shared across files. */

function uuid_() {
  return Utilities.getUuid();
}

function nowIso_() {
  return new Date().toISOString();
}

const DROP_QUERY_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gclid', 'fbclid', 'mc_cid', 'mc_eid', '_ga', 'ref', 'ref_src',
  'igshid', 'yclid', 'msclkid',
]);

/**
 * Research-database article URLs carry per-search state, so one article
 * reached from two searches looked like two pages: its saved highlights didn't
 * come back and a duplicate source was made. These rules reduce a database
 * article to the id that names it. Returns the canonical URL, or null for
 * every other site. Hosts are matched as a whole label so library proxies
 * (go-gale-com.content.elibrarymn.org) and direct hosts (go.gale.com) both hit.
 *
 * - Gale In Context: retrieve.do?docId=GALE|X (from a search: retrievalId,
 *   hitCount, currentPosition, searchId... in any order) and i.do?id=GALE|X
 *   (bookmark/proxy entry) are the same document. link.gale.com/apps/doc/X
 *   links keep their path.
 * - EBSCO Research: /c/<customer>/viewer/html/<token> and
 *   /c/<customer>/search/details/<token>?ctx=&pos=&q=... are the same record.
 */
function canonicalDatabaseUrl_(origin, path, queryStr) {
  const param = (name) => {
    const pair = queryStr.slice(1).split('&').find((kv) => kv.toLowerCase().indexOf(name + '=') === 0);
    return pair ? pair.slice(name.length + 1) : '';
  };
  if (/[\/.-]gale[.-]/i.test(origin)) {
    const docId = /\/retrieve\.do$/i.test(path) ? param('docid')
      : /\/i\.do$/i.test(path) ? param('id') : '';
    // GALE|X and GALE%7CX are the same id.
    if (docId) {
      return origin + path.replace(/[^\/]*$/, 'retrieve.do')
        + '?docId=' + docId.replace(/\|/g, '%7C').replace(/%7c/g, '%7C');
    }
    if (/\/apps\/doc\//i.test(path)) return origin + path;
  }
  if (/[\/.-]ebsco[.-]/i.test(origin)) {
    const m = path.match(/^(\/c\/[^\/]+)\/(?:viewer\/html|search\/details)\/([^\/]+)/i);
    if (m) return origin + m[1] + '/search/details/' + m[2];
  }
  return null;
}

/**
 * Strip tracking params + fragment; preserve path + meaningful query.
 * Pure string parsing — GAS V8 doesn't expose a working `URL` constructor
 * (it throws), and URLSearchParams mutations don't take. Hand-rolling is
 * the only thing that works reliably here.
 */
function normalizeUrl_(rawUrl) {
  if (!rawUrl) return '';
  const s = String(rawUrl).trim();
  // scheme://host/path?query#fragment
  const m = s.match(/^([a-z][a-z0-9+.\-]*:\/\/[^\/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/i);
  if (!m) return s; // not a parseable URL — return as-is
  const origin = m[1];
  const path = m[2] || '/';
  const queryStr = m[3] || ''; // includes leading '?'
  // fragment (m[4]) intentionally dropped
  const canonical = canonicalDatabaseUrl_(origin, path, queryStr);
  if (canonical) return canonical;
  if (!queryStr) return origin + path;
  const kept = queryStr.slice(1).split('&').filter(Boolean).filter((kv) => {
    const eq = kv.indexOf('=');
    const key = (eq >= 0 ? kv.slice(0, eq) : kv).toLowerCase();
    return !DROP_QUERY_PARAMS.has(key);
  });
  return origin + path + (kept.length ? '?' + kept.join('&') : '');
}

/**
 * The page a stored source row belongs to, under the CURRENT normalizer. Rows
 * saved before a rule change (e.g. the Gale docId rule) keep their old
 * normalizedUrl, so compare on this — re-derived from rawUrl — not on the
 * stored column.
 */
function sourcePageUrl_(source) {
  return normalizeUrl_((source && (source.rawUrl || source.normalizedUrl)) || '');
}

/** Get a Sheet tab; throw if missing. */
function getTab_(spreadsheet, tabName) {
  const tab = spreadsheet.getSheetByName(tabName);
  if (!tab) throw new Error(`Missing tab "${tabName}" in spreadsheet "${spreadsheet.getName()}"`);
  return tab;
}

/** Find a single child folder by name under a parent; null if absent. */
function findChildFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : null;
}

/**
 * Find a single non-trashed child file by name under a parent; null if absent.
 * `getFilesByName` still returns trashed files (trashing keeps the parent
 * link), so we must skip them — otherwise a Sheet that was trashed (e.g. a
 * solo Sheet absorbed into a group) would be re-found and its rows re-copied.
 */
function findChildFile_(parent, name) {
  const it = parent.getFilesByName(name);
  while (it.hasNext()) {
    const f = it.next();
    if (!f.isTrashed()) return f;
  }
  return null;
}

/**
 * Set headers on row 1 if missing, idempotent. Auto-heals a PURE TRAILING
 * APPEND: if every already-present column still matches, new columns added to
 * the end of `headers` (beyond the sheet's current width) are written as
 * labels for empty trailing columns. This never reorders or relabels existing
 * data — it only names new blank columns — so it's a safe in-place migration
 * for additive schema changes. Any mismatch WITHIN the existing columns is a
 * real reorder/rename and still throws (those need a deliberate migration).
 */
function ensureHeaders_(tab, headers) {
  if (tab.getLastRow() === 0) {
    tab.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    tab.setFrozenRows(1);
    return;
  }
  const width = tab.getLastColumn();
  const existing = tab.getRange(1, 1, 1, Math.max(width, headers.length)).getValues()[0];
  for (let i = 0; i < headers.length && i < width; i++) {
    if (existing[i] !== headers[i]) {
      throw new Error(
        `Header mismatch in "${tab.getName()}" col ${i + 1}: expected "${headers[i]}", got "${existing[i]}". ` +
        `Schema change requires a migration — do not silently rewrite headers.`
      );
    }
  }
  if (headers.length > width) {
    const appended = headers.slice(width);
    tab.getRange(1, width + 1, 1, appended.length).setValues([appended]).setFontWeight('bold');
  }
}

/** Append a row matching HEADERS order. obj is {col: value, ...}. */
function appendRow_(tab, headers, obj) {
  const row = headers.map((h) => obj[h] === undefined ? '' : obj[h]);
  tab.appendRow(row);
}

/** Build a {col: value} object from a row + headers. */
function rowToObj_(headers, row) {
  const out = {};
  for (let i = 0; i < headers.length; i++) out[headers[i]] = row[i];
  return out;
}

/**
 * Parse a JSON-string column to an object. Safe on null, empty, malformed
 * JSON, and non-string/native types (Sheets may hand back a Date or number).
 * Always returns a plain object — never null/array.
 */
function parseJsonColumn_(value) {
  if (!value || typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

/** Read all data rows as {col: value} objects. */
function readAllAsObjects_(tab, headers) {
  if (tab.getLastRow() < 2) return [];
  const values = tab.getRange(2, 1, tab.getLastRow() - 1, headers.length).getValues();
  return values.map((r) => rowToObj_(headers, r));
}

/** Find row index (1-based) by matching a key column. -1 if absent. */
function findRowByKey_(tab, headers, keyCol, keyValue) {
  const col = headers.indexOf(keyCol);
  if (col < 0) throw new Error(`Unknown column "${keyCol}"`);
  if (tab.getLastRow() < 2) return -1;
  const values = tab.getRange(2, col + 1, tab.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === keyValue) return i + 2;
  }
  return -1;
}

/** Upsert by primary key column. Overwrites the matching row; appends if absent. Idempotent. */
function upsertByKey_(tab, headers, keyCol, obj) {
  const rowIdx = findRowByKey_(tab, headers, keyCol, obj[keyCol]);
  const row = headers.map((h) => obj[h] === undefined ? '' : obj[h]);
  if (rowIdx < 0) {
    tab.appendRow(row);
  } else {
    tab.getRange(rowIdx, 1, 1, headers.length).setValues([row]);
  }
}

/** Tiny stable string hash (djb2) → base36. For cache-key fingerprints. */
function shortHash_(str) {
  let h = 5381;
  const s = String(str);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
