/**
 * Per-(project, student) → spreadsheet + tab-gid manifest.
 *
 * Resolving a solo student's Sheet the canonical way walks Drive
 * (folder-by-name → file-by-name → open) — Drive API calls that are
 * surprisingly slow and, in the dashboard, paid once PER STUDENT. This manifest
 * is a flat lookup that turns the whole project's solo IDs into ONE Sheet read,
 * which also feeds the parallel batch reader (it CSV-exports each tab by gid, so
 * it needs the spreadsheet id AND the Sources/Highlights tab gids up front).
 *
 * It is a DERIVED CACHE, never the source of truth — the per-student Sheets
 * remain authoritative. Every read path degrades gracefully: a missing/partial
 * entry falls back to the Drive walk and (best-effort) backfills the manifest,
 * so there is NO migration to run. The manifest self-populates as Sheets are
 * created (provisioning) and as the dashboard resolves misses.
 *
 * Stored as a `SheetManifest` tab on the Projects registry workbook. Keyed on
 * `projectId|emailLower` so an upsert is O(1)-ish via upsertByKey_.
 */

var MANIFEST_TAB = 'SheetManifest';
var MANIFEST_HEADERS = ['key', 'projectId', 'email', 'spreadsheetId', 'sourcesGid', 'highlightsGid', 'updatedAt'];

function manifestKey_(projectId, email) {
  return String(projectId) + '|' + String(email || '').trim().toLowerCase();
}

/** The manifest tab, created (and self-healed) with the current headers. */
function getManifestTab_() {
  const ss = SpreadsheetApp.openById(CONFIG.PROJECTS_SHEET_ID);
  let tab = ss.getSheetByName(MANIFEST_TAB);
  if (!tab) tab = ss.insertSheet(MANIFEST_TAB);
  ensureManifestHeaders_(tab);
  return tab;
}

/**
 * Header guard for the manifest tab. UNLIKE the authoritative student Sheets
 * (where ensureHeaders_ is strict and refuses to migrate), the manifest is a
 * DERIVED CACHE — fully rebuildable from Drive + provisioning. So on ANY header
 * mismatch (e.g. a schema bump that inserts columns) we just clear the tab and
 * rewrite headers; the entries repopulate on the next provisioning + dashboard
 * load. This keeps the manifest schema free to evolve with no migration.
 */
function ensureManifestHeaders_(tab) {
  if (tab.getLastRow() === 0) {
    tab.getRange(1, 1, 1, MANIFEST_HEADERS.length).setValues([MANIFEST_HEADERS]).setFontWeight('bold');
    tab.setFrozenRows(1);
    return;
  }
  const width = tab.getLastColumn();
  const existing = tab.getRange(1, 1, 1, Math.max(width, MANIFEST_HEADERS.length)).getValues()[0];
  const matches = MANIFEST_HEADERS.every((h, i) => existing[i] === h) && width === MANIFEST_HEADERS.length;
  if (matches) return;
  // Stale/old-schema derived cache — safe to nuke and rebuild.
  console.info('[OPS] SheetManifest schema changed — clearing and rebuilding (derived cache).');
  tab.clear();
  tab.getRange(1, 1, 1, MANIFEST_HEADERS.length).setValues([MANIFEST_HEADERS]).setFontWeight('bold');
  tab.setFrozenRows(1);
}

/**
 * Load every solo-Sheet entry for a project as
 *   { emailLower: { id, sgid, hgid } }
 * Best-effort: returns {} if the manifest tab doesn't exist yet or can't be
 * read, so callers transparently fall back to the Drive walk. An entry missing
 * its gids is returned as-is; the caller treats it as incomplete and re-resolves.
 */
function loadProjectManifest_(projectId) {
  try {
    const rows = readAllAsObjects_(getManifestTab_(), MANIFEST_HEADERS);
    const map = {};
    rows.forEach((r) => {
      if (String(r.projectId) !== String(projectId)) return;
      const email = String(r.email || '').trim().toLowerCase();
      if (email && r.spreadsheetId) {
        map[email] = {
          id: String(r.spreadsheetId),
          sgid: r.sourcesGid === '' || r.sourcesGid === null ? '' : String(r.sourcesGid),
          hgid: r.highlightsGid === '' || r.highlightsGid === null ? '' : String(r.highlightsGid),
        };
      }
    });
    return map;
  } catch (e) {
    console.warn('[OPS] loadProjectManifest_ failed: ' + (e && e.message || e));
    return {};
  }
}

/** True if a manifest entry has everything the CSV-export reader needs. */
function manifestEntryComplete_(entry) {
  return !!(entry && entry.id && entry.sgid !== '' && entry.hgid !== '');
}

/**
 * Raw upsert of a manifest row. Best-effort by default — a manifest write must
 * never break provisioning or a dashboard load (the Drive fallback always
 * works). Pass throwOnError=true only from tests that want to assert the write.
 */
function recordSoloSheetEntry_(projectId, email, spreadsheetId, sourcesGid, highlightsGid, throwOnError) {
  try {
    if (!projectId || !email || !spreadsheetId) return;
    upsertByKey_(getManifestTab_(), MANIFEST_HEADERS, 'key', {
      key: manifestKey_(projectId, email),
      projectId: String(projectId),
      email: String(email).trim().toLowerCase(),
      spreadsheetId: String(spreadsheetId),
      sourcesGid: String(sourcesGid === undefined || sourcesGid === null ? '' : sourcesGid),
      highlightsGid: String(highlightsGid === undefined || highlightsGid === null ? '' : highlightsGid),
      updatedAt: nowIso_(),
    });
  } catch (e) {
    console.warn('[OPS] recordSoloSheetEntry_ failed: ' + (e && e.message || e));
    if (throwOnError) throw e;
  }
}

/**
 * Convenience recorder that derives the spreadsheet id + Sources/Highlights tab
 * gids from a live Spreadsheet object. Used by provisioning (on create) and by
 * the dashboard's miss-path backfill.
 */
function recordSoloSheetForSs_(projectId, email, ss) {
  try {
    if (!ss) return;
    const sgid = tabGid_(ss, TABS.SOURCES);
    const hgid = tabGid_(ss, TABS.HIGHLIGHTS);
    recordSoloSheetEntry_(projectId, email, ss.getId(), sgid, hgid);
  } catch (e) {
    console.warn('[OPS] recordSoloSheetForSs_ failed: ' + (e && e.message || e));
  }
}

/** A tab's numeric gid (as a string), or '' if the tab is missing. */
function tabGid_(ss, tabName) {
  const tab = ss.getSheetByName(tabName);
  return tab ? String(tab.getSheetId()) : '';
}

/** Drop a manifest entry (e.g. when a solo Sheet is trashed by a merge). Best-effort. */
function forgetSoloSheetId_(projectId, email) {
  try {
    const tab = getManifestTab_();
    const rowIdx = findRowByKey_(tab, MANIFEST_HEADERS, 'key', manifestKey_(projectId, email));
    if (rowIdx > 0) tab.deleteRow(rowIdx);
  } catch (e) {
    console.warn('[OPS] forgetSoloSheetId_ failed: ' + (e && e.message || e));
  }
}
