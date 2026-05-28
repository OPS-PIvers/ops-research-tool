/**
 * Group Sheets — Phase 4 sub-project D.
 *
 * A group Sheet is structurally identical to a per-student Sheet
 * (Meta, Sources, Highlights tabs) plus a Members tab that tracks
 * the group's current and past members. Each member's per-student
 * Sheet is moved to <class>/Archived-students/ when they join, and
 * restored when they leave (un-merge, disband).
 *
 * This file holds:
 *   - Read primitives (find/list/get; this task).
 *   - Mutation helpers (create, copy, archive, restore; Task 4).
 *
 * Group routing into provisioning + reads lives in 11_provisioning.js
 * and 21_reads.js (Task 3), both of which call findGroupSheetForStudent_
 * before falling through to the solo-Sheet path.
 */

// Request-scoped cache so consoleGetProjectDashboard doesn't open the
// same group Sheet N times for an N-member group. Keyed on
// `<emailLower>|<projectId>` → Spreadsheet object or the sentinel `false`
// (meaning "we already looked and there is no group").
let _groupSheetCache = null;

/** Clear the request-scoped cache. Call from entry points if needed. */
function resetGroupSheetCache_() {
  _groupSheetCache = {};
}

/**
 * Find the active group Sheet for (student, project), or null.
 *
 * Implementation: walk the student's class folder for files whose name
 * starts with NAMES.GROUP_SHEET_PREFIX, open each, scan the Members tab
 * for an entry with this email and an empty leftAt. Return the first
 * match's Spreadsheet object.
 *
 * Cost: O(groups × open). At a typical project (<10 groups per class)
 * this is sub-second; the cache amortizes the rest of a doPost or
 * dashboard load.
 */
function findGroupSheetForStudent_(actorEmail, project) {
  if (!actorEmail || !project) return null;
  if (_groupSheetCache === null) _groupSheetCache = {};
  const cacheKey = String(actorEmail).toLowerCase() + '|' + project.projectId;
  if (cacheKey in _groupSheetCache) {
    return _groupSheetCache[cacheKey] || null;
  }

  const roster = getStudentRosterEntry_(actorEmail);
  if (!roster) { _groupSheetCache[cacheKey] = false; return null; }

  const projectFolder = DriveApp.getFolderById(project.rootFolderId);
  const classFolder = findChildFolder_(projectFolder, roster.Class);
  if (!classFolder) { _groupSheetCache[cacheKey] = false; return null; }

  const target = String(actorEmail).toLowerCase();
  const files = classFolder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const name = f.getName();
    if (name.indexOf(NAMES.GROUP_SHEET_PREFIX) !== 0) continue;
    let ss;
    try { ss = SpreadsheetApp.openById(f.getId()); }
    catch (e) { continue; }  // file may not be a Sheet; skip
    const membersTab = ss.getSheetByName(TABS.GROUP_MEMBERS);
    if (!membersTab) continue;
    const rows = readAllAsObjects_(membersTab, HEADERS.GROUP_MEMBERS);
    const hit = rows.find((r) =>
      String(r.email || '').toLowerCase() === target &&
      !String(r.leftAt || '').trim()
    );
    if (hit) {
      _groupSheetCache[cacheKey] = ss;
      return ss;
    }
  }

  _groupSheetCache[cacheKey] = false;
  return null;
}

/**
 * List every active group in a project. If classFilter is provided,
 * restrict to that single class. Returns:
 *   [{ groupId, name, className, sheetId, memberEmails: [string],
 *      memberCount: number }, ...]
 *
 * "Active" = group Sheet lives in the class folder (not under
 * Archived-students/). Disbanded groups are filtered out here.
 */
function listGroupsForProject_(project, classFilter) {
  const out = [];
  const projectFolder = DriveApp.getFolderById(project.rootFolderId);
  const classFolders = projectFolder.getFolders();
  while (classFolders.hasNext()) {
    const cf = classFolders.next();
    if (cf.getName() === NAMES.ARCHIVED_STUDENTS_FOLDER) continue;  // not a class
    if (classFilter && cf.getName() !== classFilter) continue;
    const files = cf.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      const name = f.getName();
      if (name.indexOf(NAMES.GROUP_SHEET_PREFIX) !== 0) continue;
      let ss;
      try { ss = SpreadsheetApp.openById(f.getId()); }
      catch (e) { continue; }
      const meta = readGroupMeta_(ss);
      if (!meta || !meta.groupId) continue;
      if (meta.projectId !== project.projectId) continue;
      const current = currentMembers_(ss);
      out.push({
        groupId: meta.groupId,
        name: String(meta.studentName || '').replace(/^\[grp\] /, ''),
        className: cf.getName(),
        sheetId: f.getId(),
        memberEmails: current.map((m) => m.email),
        memberCount: current.length,
      });
    }
  }
  return out;
}

/** Find a single group by groupId across the whole project. Null if absent. */
function getGroupById_(project, groupId) {
  if (!groupId) return null;
  return listGroupsForProject_(project).find((g) => g.groupId === groupId) || null;
}

/**
 * Read the single Meta row from a Sheet (group OR solo). Returns the
 * object or null if the row is missing.
 */
function readGroupMeta_(ss) {
  const tab = ss.getSheetByName(TABS.META);
  if (!tab) return null;
  const rows = readAllAsObjects_(tab, HEADERS.META);
  return rows[0] || null;
}

/** Read all Members rows from a group Sheet. */
function readGroupMembers_(ss) {
  const tab = ss.getSheetByName(TABS.GROUP_MEMBERS);
  if (!tab) return [];
  return readAllAsObjects_(tab, HEADERS.GROUP_MEMBERS);
}

/** Filter Members to current (empty leftAt). */
function currentMembers_(ss) {
  return readGroupMembers_(ss).filter((m) => !String(m.leftAt || '').trim());
}

/** Find the group Sheet file by groupId (Drive file, not Spreadsheet). */
function findGroupFileByGroupId_(project, groupId) {
  const projectFolder = DriveApp.getFolderById(project.rootFolderId);
  const classFolders = projectFolder.getFolders();
  while (classFolders.hasNext()) {
    const cf = classFolders.next();
    // Include the active class folder AND the Archived-students subfolder
    // (so disband / cleanup operations can find archived group Sheets too).
    const candidates = [cf];
    const archived = findChildFolder_(cf, NAMES.ARCHIVED_STUDENTS_FOLDER);
    if (archived) candidates.push(archived);
    for (let i = 0; i < candidates.length; i++) {
      const files = candidates[i].getFiles();
      while (files.hasNext()) {
        const f = files.next();
        if (f.getName().indexOf(NAMES.GROUP_SHEET_PREFIX) !== 0) continue;
        let ss;
        try { ss = SpreadsheetApp.openById(f.getId()); }
        catch (e) { continue; }
        const meta = readGroupMeta_(ss);
        if (meta && meta.groupId === groupId) {
          return { file: f, spreadsheet: ss, classFolder: cf, parent: candidates[i] };
        }
      }
    }
  }
  return null;
}
