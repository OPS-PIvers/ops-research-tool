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

  const roster = getStudentRosterEntry_(actorEmail);
  if (!roster) return null;
  const projectFolder = DriveApp.getFolderById(project.rootFolderId);
  const classFolder = findChildFolder_(projectFolder, roster.Class);
  if (!classFolder) return null;
  const file = findChildFile_(classFolder, actorEmail);
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
 * The extension calls this before creating a new source so two highlights on
 * the same page (after tracking params are stripped) attach to one source
 * instead of duplicating. Returns the existing source row or null.
 */
function findSourceByNormalizedUrl_(actorEmail, projectId, normalizedUrl) {
  if (!normalizedUrl) return null;
  const sources = readSourcesForActor_(actorEmail, projectId);
  return sources.find((s) => s.normalizedUrl === normalizedUrl) || null;
}
