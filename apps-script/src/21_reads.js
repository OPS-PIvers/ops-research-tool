/**
 * Read paths for the sidebar (Phase 3) and dashboard (Phase 4).
 * Phase 1 ships the primitives; the endpoints in 30 expose them via doGet.
 */

function getStudentSheetIfExists_(actorEmail, project) {
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
