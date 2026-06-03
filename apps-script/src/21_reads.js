/**
 * Read paths for the sidebar (Phase 3) and dashboard (Phase 4).
 * Phase 1 ships the primitives; the endpoints in 30 expose them via doGet.
 */

function getStudentSheetIfExists_(actorEmail, project) {
  // Group routing — see findOrCreateStudentSheet_ for the equivalent
  // write-side hook. Reads must route identically or the sidebar will
  // show stale solo-Sheet data after a merge.
  const groupSheet = findGroupSheetForStudent_(actorEmail, project);
  if (groupSheet) return groupSheet;
  return getSoloSheetIfExists_(actorEmail, project);
}

/** Per-student Sheet if it exists, else null. SOLO ONLY (bypasses groups). */
function getSoloSheetIfExists_(actorEmail, project) {
  const roster = getStudentRosterEntry_(actorEmail);
  if (!roster) return null;
  const projectFolder = DriveApp.getFolderById(project.rootFolderId);
  const classFolder = findChildFolder_(projectFolder, roster.Class);
  if (!classFolder) return null;
  const file = findSoloSheetFile_(classFolder, actorEmail);
  return file ? SpreadsheetApp.openById(file.getId()) : null;
}

function readSourcesForActor_(actorEmail, projectId) {
  const project = getProject_(projectId);
  if (!project) return [];
  const ss = getStudentSheetIfExists_(actorEmail, project);
  if (!ss) return [];
  return readAllAsObjects_(getTab_(ss, TABS.SOURCES), HEADERS.SOURCES);
}

function readHighlightsForActor_(actorEmail, projectId) {
  const project = getProject_(projectId);
  if (!project) return [];
  const ss = getStudentSheetIfExists_(actorEmail, project);
  if (!ss) return [];
  return readAllAsObjects_(getTab_(ss, TABS.HIGHLIGHTS), HEADERS.HIGHLIGHTS);
}

/**
 * Collapse duplicate source rows that share a normalizedUrl AND author — the
 * accepted "two source rows for one page" window (e.g. one student highlighting
 * a page on two devices before a sync settled, build plan §2). Keeps the OLDEST
 * row as canonical, folds each duplicate's citation work into it (canonical's
 * non-empty values win; only blanks are filled), and repoints the duplicates'
 * highlights onto the canonical sourceId.
 *
 * Scoping by `createdByEmail` matters in a GROUP Sheet: two different members
 * may each legitimately have a source row for the same page — those are NOT
 * duplicates and must never be merged across members (build plan §Groups). Only
 * same-author, same-URL rows collapse.
 *
 * Pure function — unit-testable. Callers either use the result for display or
 * persist it (dedupeSourcesPersist_) to physically remove the dup rows.
 *
 * Sources with a blank normalizedUrl pass through unchanged (we can't prove
 * they're the same page).
 */
function dedupeSourcesByUrl_(sources, highlights) {
  const groups = {};
  const passthrough = [];
  (sources || []).forEach((s) => {
    const url = s && s.normalizedUrl ? s.normalizedUrl : '';
    if (!url) { passthrough.push(s); return; }
    const key = url + ' | ' + (s.createdByEmail || '');
    (groups[key] = groups[key] || []).push(s);
  });

  const canonicalById = {}; // duplicate sourceId -> canonical sourceId
  const canonicals = [];
  Object.keys(groups).forEach((key) => {
    const grp = groups[key].slice().sort((a, b) =>
      String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    );
    const canonical = grp[0];
    for (let i = 1; i < grp.length; i++) {
      canonicalById[grp[i].sourceId] = canonical.sourceId;
      mergeSourceCitationInto_(canonical, grp[i]);
    }
    canonicals.push(canonical);
  });

  const outHighlights = (highlights || []).map((h) =>
    (h && canonicalById[h.sourceId]) ? Object.assign({}, h, { sourceId: canonicalById[h.sourceId] }) : h
  );
  return { sources: passthrough.concat(canonicals), highlights: outHighlights };
}

/**
 * Fold a duplicate source's citation work into the canonical row IN PLACE.
 * Canonical's non-empty values always win; only blanks are filled. Mutates
 * `canonical` (callers own the row objects for the duration of one request).
 */
function mergeSourceCitationInto_(canonical, dup) {
  ['scrapedTitle', 'scrapedSite', 'scrapedDate', 'scrapedAuthor', 'sourceType', 'annotation']
    .forEach((k) => { if (!canonical[k] && dup[k]) canonical[k] = dup[k]; });
  if ((!canonical.primarySecondary || canonical.primarySecondary === 'unset') &&
      dup.primarySecondary && dup.primarySecondary !== 'unset') {
    canonical.primarySecondary = dup.primarySecondary;
  }
  // citationFields / scrapedExtra: merge per-key — canonical wins for shared
  // keys, duplicate-only keys are added.
  const mergeJson = (canonStr, dupStr) => {
    const c = parseJsonColumn_(canonStr) || {};
    const d = parseJsonColumn_(dupStr) || {};
    const out = Object.assign({}, d, c);
    return Object.keys(out).length ? JSON.stringify(out) : '';
  };
  const cf = mergeJson(canonical.citationFields, dup.citationFields);
  if (cf) canonical.citationFields = cf;
  const ex = mergeJson(canonical.scrapedExtra, dup.scrapedExtra);
  if (ex) canonical.scrapedExtra = ex;
}

/**
 * The extension calls this before creating a new source so two highlights on
 * the same page (after tracking params are stripped) attach to one source
 * instead of duplicating. Returns the existing source row or null.
 */
function findSourceByNormalizedUrl_(actorEmail, projectId, normalizedUrl) {
  if (!normalizedUrl) return null;
  const sources = readSourcesForActor_(actorEmail, projectId);
  return sources.find((s) => s.normalizedUrl === normalizedUrl) || null;
}
