/** Small generic helpers shared across files. */

function uuid_() {
  return Utilities.getUuid();
}

function nowIso_() {
  return new Date().toISOString();
}

/** Strip tracking params + fragment; preserve path + meaningful query. */
function normalizeUrl_(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    const drop = new Set([
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'gclid', 'fbclid', 'mc_cid', 'mc_eid', '_ga', 'ref', 'ref_src',
      'igshid', 'yclid', 'msclkid',
    ]);
    const keep = [];
    u.searchParams.forEach((v, k) => { if (!drop.has(k.toLowerCase())) keep.push([k, v]); });
    u.search = '';
    keep.forEach(([k, v]) => u.searchParams.append(k, v));
    return u.toString();
  } catch (e) {
    return String(rawUrl || '').trim();
  }
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

/** Find a single child file by name under a parent; null if absent. */
function findChildFile_(parent, name) {
  const it = parent.getFilesByName(name);
  return it.hasNext() ? it.next() : null;
}

/** Set headers on row 1 if missing, idempotent. */
function ensureHeaders_(tab, headers) {
  if (tab.getLastRow() === 0) {
    tab.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    tab.setFrozenRows(1);
    return;
  }
  const existing = tab.getRange(1, 1, 1, Math.max(tab.getLastColumn(), headers.length)).getValues()[0];
  for (let i = 0; i < headers.length; i++) {
    if (existing[i] !== headers[i]) {
      throw new Error(
        `Header mismatch in "${tab.getName()}" col ${i + 1}: expected "${headers[i]}", got "${existing[i]}". ` +
        `Schema change requires a migration — do not silently rewrite headers.`
      );
    }
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
