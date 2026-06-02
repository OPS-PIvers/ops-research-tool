/**
 * Parallel multi-Spreadsheet reader for the Teacher Console dashboard.
 *
 * The dashboard fans out across every student's per-(student, project)
 * Spreadsheet. Apps Script has no threads, so the naive path —
 * `SpreadsheetApp.openById` + `getValues` per student, in a loop — is strictly
 * SERIAL: N × (open + read), ~0.3–1s each. For a section that's 10–25s.
 *
 * This module reads them CONCURRENTLY by CSV-exporting each tab through
 * `UrlFetchApp.fetchAll`, which fires all requests in parallel and returns when
 * the slowest completes. It hits the Drive **export** endpoint
 * (`docs.google.com/spreadsheets/d/{id}/export?format=csv&gid={gid}`), NOT the
 * Sheets REST API — so it works on the script's default (locked) GCP project
 * with only the Drive scope the project already grants (DriveApp is used
 * throughout; `script.external_request` is added the first time UrlFetchApp is
 * referenced). Auth rides on `ScriptApp.getOAuthToken()`; the Web App executes
 * as the deploying user (Paul), who owns every Sheet.
 *
 * Export is per-tab by gid, so each Spreadsheet costs TWO requests (Sources +
 * Highlights). CSV is parsed with the built-in `Utilities.parseCsv`, which
 * handles quoted/multiline cells (annotations, highlight text) correctly. Rows
 * map positionally to HEADERS — same column order as the Sheet — so the result
 * is byte-for-byte equivalent to the serial readAllAsObjects_ path for every
 * field the dashboard aggregator consumes (asserted by
 * devTestDashboardParityParallelVsSerial).
 */

// How many SPREADSHEETS per fetchAll batch. Each is 2 requests (Sources +
// Highlights), so 25 sheets ≈ 50 concurrent requests — comfortably within
// UrlFetchApp limits; chunking keeps whole-grade projects bounded.
var BATCH_READ_CHUNK = 25;

/**
 * Read Sources + Highlights for many Spreadsheets in parallel via CSV export.
 *
 * @param {Array<{id:string, sourcesGid:(string|number), highlightsGid:(string|number)}>} descriptors
 *        Spreadsheet id + the two tab gids. Deduped by id by this function.
 *        A descriptor missing either gid is skipped (recorded as an error) —
 *        the caller resolves/ backfills gids before calling.
 * @return {{ data: Object, errors: Array }}
 *   data:   id → { sources: [obj], highlights: [obj] }
 *   errors: [{ id, kind, status, error }]. A single failed export never aborts
 *           the batch — it lands in `errors` and that tab reads empty, so the
 *           dashboard still renders (and the caller can fall back to serial if
 *           EVERYTHING failed).
 */
function batchReadStudentData_(descriptors) {
  const unique = [];
  const seen = {};
  (descriptors || []).forEach((d) => {
    if (d && d.id && !seen[d.id]) { seen[d.id] = true; unique.push(d); }
  });

  const data = {};
  const errors = [];
  if (unique.length === 0) return { data, errors };
  unique.forEach((d) => { data[d.id] = { sources: [], highlights: [] }; });

  const token = ScriptApp.getOAuthToken();
  const authHeader = { Authorization: 'Bearer ' + token };

  for (let start = 0; start < unique.length; start += BATCH_READ_CHUNK) {
    const chunk = unique.slice(start, start + BATCH_READ_CHUNK);

    // Flatten to one request per (sheet, tab); a parallel meta array remembers
    // which response belongs to which sheet + tab.
    const requests = [];
    const meta = [];
    chunk.forEach((d) => {
      if (d.sourcesGid === '' || d.sourcesGid === undefined || d.sourcesGid === null ||
          d.highlightsGid === '' || d.highlightsGid === undefined || d.highlightsGid === null) {
        errors.push({ id: d.id, kind: 'gid', status: 'missing', error: 'descriptor missing tab gid' });
        return;
      }
      requests.push({ url: csvExportUrl_(d.id, d.sourcesGid), method: 'get', headers: authHeader, muteHttpExceptions: true });
      meta.push({ id: d.id, kind: 'sources' });
      requests.push({ url: csvExportUrl_(d.id, d.highlightsGid), method: 'get', headers: authHeader, muteHttpExceptions: true });
      meta.push({ id: d.id, kind: 'highlights' });
    });
    if (requests.length === 0) continue;

    const responses = UrlFetchApp.fetchAll(requests);
    responses.forEach((resp, i) => {
      const m = meta[i];
      try {
        const code = resp.getResponseCode();
        if (code !== 200) {
          errors.push({ id: m.id, kind: m.kind, status: code, error: resp.getContentText().slice(0, 200) });
          return;
        }
        const rows = parseCsvRows_(resp.getContentText());
        if (m.kind === 'sources') {
          data[m.id].sources = rows.map((r) => rowToObj_(HEADERS.SOURCES, padRow_(r, HEADERS.SOURCES.length)));
        } else {
          data[m.id].highlights = rows.map((r) => rowToObj_(HEADERS.HIGHLIGHTS, padRow_(r, HEADERS.HIGHLIGHTS.length)));
        }
      } catch (e) {
        errors.push({ id: m.id, kind: m.kind, status: 'parse', error: String(e && e.message || e) });
      }
    });
  }

  return { data, errors };
}

/** Per-tab CSV export URL. */
function csvExportUrl_(spreadsheetId, gid) {
  return 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(spreadsheetId) +
    '/export?format=csv&gid=' + encodeURIComponent(gid);
}

/**
 * Parse exported CSV into DATA rows (header row 1 dropped). Safe on empty
 * exports. Utilities.parseCsv handles quoted commas/newlines, so multiline
 * annotations and highlight text round-trip correctly.
 */
function parseCsvRows_(text) {
  if (!text || !String(text).trim()) return [];
  const all = Utilities.parseCsv(text);
  if (all.length <= 1) return [];
  // Drop the header row, and any all-empty row (a trailing newline in the
  // export can yield a phantom blank row the serial getValues() path never
  // produces — keeping it would inflate source/highlight counts).
  return all.slice(1).filter((row) => row.some((cell) => String(cell).trim() !== ''));
}

/** Pad a (possibly short) CSV row to `len`, filling blanks with ''. */
function padRow_(row, len) {
  const out = (row || []).slice(0, len);
  while (out.length < len) out.push('');
  return out;
}
