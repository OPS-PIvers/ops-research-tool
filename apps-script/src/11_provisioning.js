/**
 * Lazy provisioning of per-(student, project) Sheets.
 *
 * Layout (per build plan §3):
 *   [Project Root Folder]
 *     [Class folder]
 *       [student-email] Sheet  (tabs: Meta, Sources, Highlights)
 *
 * Phase 1 implements the SOLO path. Group routing is a Phase 4 add-on:
 *   if a (project, student) is in a group, route to the group Sheet instead.
 */

/** Find or create the project's root folder under the global root. */
function findOrCreateProjectFolder_(projectName) {
  const root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);
  return findChildFolder_(root, projectName) || root.createFolder(projectName);
}

/** Find or create a class folder under a project's root folder. */
function findOrCreateClassFolder_(projectFolder, className) {
  return findChildFolder_(projectFolder, className) || projectFolder.createFolder(className);
}

/**
 * Resolve the Sheet a (student, project) writes to. Current members of an
 * active group route to the shared group Sheet; everyone else gets their
 * per-student Sheet. The group hook is the single chokepoint that re-points
 * doPost, the sidebar, and source-dedup at once.
 */
function findOrCreateStudentSheet_(actorEmail, project) {
  const groupSheet = findGroupSheetForStudent_(actorEmail, project);
  if (groupSheet) return groupSheet;
  return findOrCreateSoloSheet_(actorEmail, project);
}

/**
 * The per-(student, project) Sheet, fully initialized. Idempotent. SOLO
 * ONLY — bypasses group routing, so un-merge can rebuild a member's personal
 * Sheet even while the registry still lists them as grouped.
 */
function findOrCreateSoloSheet_(actorEmail, project) {
  const rosterEntry = getStudentRosterEntry_(actorEmail);
  if (!rosterEntry) {
    throw new Error(`Email ${actorEmail} is not on the roster — refusing to provision.`);
  }
  const projectFolder = DriveApp.getFolderById(project.rootFolderId);
  const classFolder = findOrCreateClassFolder_(projectFolder, rosterEntry.Class);
  const sheetName = actorEmail; // canonical; plan §3 says `[student-email] Sheet`
  let file = findChildFile_(classFolder, sheetName);
  if (file) {
    return SpreadsheetApp.openById(file.getId());
  }
  // Create + move + init
  const ss = SpreadsheetApp.create(sheetName);
  const newFile = DriveApp.getFileById(ss.getId());
  classFolder.addFile(newFile);
  DriveApp.getRootFolder().removeFile(newFile);
  // Rename the default Sheet1 → Meta, then add Sources + Highlights
  const sheets = ss.getSheets();
  sheets[0].setName(TABS.META);
  ss.insertSheet(TABS.SOURCES);
  ss.insertSheet(TABS.HIGHLIGHTS);
  ensureHeaders_(getTab_(ss, TABS.META), HEADERS.META);
  ensureHeaders_(getTab_(ss, TABS.SOURCES), HEADERS.SOURCES);
  ensureHeaders_(getTab_(ss, TABS.HIGHLIGHTS), HEADERS.HIGHLIGHTS);
  // Populate Meta (single row) — names composed from First/Last; teacher
  // is the display string (TeacherEmail is the join key, kept in roster).
  appendRow_(getTab_(ss, TABS.META), HEADERS.META, {
    studentName: (String(rosterEntry.Last || '') + ', ' + String(rosterEntry.First || '')).replace(/^, |, $/g, ''),
    studentEmail: actorEmail,
    class: rosterEntry.Class,
    teacher: rosterEntry.Teacher || rosterEntry.TeacherEmail || '',
    projectId: project.projectId,
    groupId: '',
  });
  return ss;
}
