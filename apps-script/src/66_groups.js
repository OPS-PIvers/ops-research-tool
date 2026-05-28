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

// ============================================================
// Mutation helpers — used by consoleGroup* endpoints (Tasks 5-6)
// ============================================================

/**
 * Validate the inputs for a merge before any side effects run.
 * Throws on the first violation. Pure (no Sheet writes).
 */
function validateGroupCreate_(project, name, memberEmails) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('Group name is required');
  if (trimmedName.length > 60) throw new Error('Group name must be ≤ 60 characters');
  if (!Array.isArray(memberEmails) || memberEmails.length < 2 || memberEmails.length > 4) {
    throw new Error('A group must have 2–4 members');
  }
  const lowered = memberEmails.map((e) => String(e || '').toLowerCase());
  const seen = {};
  lowered.forEach((e) => {
    if (!e) throw new Error('Empty member email');
    if (seen[e]) throw new Error('Duplicate member email: ' + e);
    seen[e] = true;
  });
  // Roster check + same-class check.
  const rosters = lowered.map((e) => {
    const r = getStudentRosterEntry_(e);
    if (!r) throw new Error('Not on roster: ' + e);
    return r;
  });
  const classes = {};
  rosters.forEach((r) => { classes[String(r.Class || '').trim()] = true; });
  if (Object.keys(classes).length !== 1) {
    throw new Error('All group members must share the same class');
  }
  const sharedClass = Object.keys(classes)[0];
  const projectClasses = projectClassList_(project);
  if (projectClasses.indexOf(sharedClass) < 0) {
    throw new Error('Class ' + sharedClass + ' is not enrolled in this project');
  }
  // Not already in a group in this project.
  lowered.forEach((e) => {
    const existing = findGroupSheetForStudent_(e, project);
    if (existing) {
      throw new Error(e + ' is already in a group — move them out first');
    }
  });
  return { rosters, sharedClass, lowered, trimmedName };
}

/**
 * Create the group Sheet, initialize tabs and headers, populate Meta and
 * Members. Returns { spreadsheet, groupId, name, classFolder }.
 *
 * Does not migrate any per-student rows — that's copyMemberRowsIntoGroup_.
 */
function createGroupSheet_(project, classFolder, name, groupId, rosterEntries) {
  const sheetName = NAMES.GROUP_SHEET_PREFIX + name;
  const ss = SpreadsheetApp.create(sheetName);
  const file = DriveApp.getFileById(ss.getId());
  classFolder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);

  const sheets = ss.getSheets();
  sheets[0].setName(TABS.META);
  ss.insertSheet(TABS.GROUP_MEMBERS);
  ss.insertSheet(TABS.SOURCES);
  ss.insertSheet(TABS.HIGHLIGHTS);

  ensureHeaders_(getTab_(ss, TABS.META),          HEADERS.META);
  ensureHeaders_(getTab_(ss, TABS.GROUP_MEMBERS), HEADERS.GROUP_MEMBERS);
  ensureHeaders_(getTab_(ss, TABS.SOURCES),       HEADERS.SOURCES);
  ensureHeaders_(getTab_(ss, TABS.HIGHLIGHTS),    HEADERS.HIGHLIGHTS);

  // Meta — see spec §6.2 for column repurposing.
  appendRow_(getTab_(ss, TABS.META), HEADERS.META, {
    studentName: name,
    studentEmail: '',
    class: classFolder.getName(),
    teacher: '',
    projectId: project.projectId,
    groupId: groupId,
  });

  // Members — one row per joining member, leftAt empty.
  const joinedAt = nowIso_();
  const membersTab = getTab_(ss, TABS.GROUP_MEMBERS);
  rosterEntries.forEach((r) => {
    appendRow_(membersTab, HEADERS.GROUP_MEMBERS, {
      email:     String(r.Email || '').toLowerCase(),
      firstName: String(r.First || ''),
      lastName:  String(r.Last  || ''),
      joinedAt:  joinedAt,
      leftAt:    '',
    });
  });

  return { spreadsheet: ss, groupId, name, classFolder };
}

/**
 * Bulk copy all Sources + Highlights rows from a per-student Sheet into a
 * group Sheet. Rows are inserted as-is — sourceId, highlightId,
 * createdByEmail, createdAt, projectId all preserved.
 *
 * Returns { sourcesCopied, highlightsCopied }.
 */
function copyMemberRowsIntoGroup_(groupSpreadsheet, studentSpreadsheet) {
  const out = { sourcesCopied: 0, highlightsCopied: 0 };

  [TABS.SOURCES, TABS.HIGHLIGHTS].forEach((tabName) => {
    const headers = (tabName === TABS.SOURCES) ? HEADERS.SOURCES : HEADERS.HIGHLIGHTS;
    const fromTab = studentSpreadsheet.getSheetByName(tabName);
    if (!fromTab) return;
    const rows = readAllAsObjects_(fromTab, headers);
    if (rows.length === 0) return;
    const toTab = getTab_(groupSpreadsheet, tabName);
    const matrix = rows.map((row) => headers.map((h) => row[h] === undefined ? '' : row[h]));
    toTab.getRange(toTab.getLastRow() + 1, 1, matrix.length, headers.length).setValues(matrix);
    if (tabName === TABS.SOURCES) out.sourcesCopied += rows.length;
    else                          out.highlightsCopied += rows.length;
  });

  return out;
}

/**
 * Stamp Meta.groupId on a per-student Sheet. Used to mark a solo Sheet as
 * "belongs to group <id>" before archiving it. Idempotent.
 */
function setSoloMetaGroupId_(studentSpreadsheet, groupId) {
  const metaTab = getTab_(studentSpreadsheet, TABS.META);
  const col = HEADERS.META.indexOf('groupId') + 1;
  if (col < 1) throw new Error('META header missing groupId column');
  // Meta has exactly one row per the per-student-Sheet invariant; row 2.
  if (metaTab.getLastRow() < 2) return;
  metaTab.getRange(2, col).setValue(groupId || '');
}

/**
 * Move a per-student Sheet from its class folder into the class's
 * Archived-students/ subfolder. Idempotent: no-op if already archived.
 *
 * Returns the Drive File object after move.
 */
function archiveStudentSheetForGroup_(studentFile, classFolder) {
  const archived = findChildFolder_(classFolder, NAMES.ARCHIVED_STUDENTS_FOLDER) ||
                   classFolder.createFolder(NAMES.ARCHIVED_STUDENTS_FOLDER);
  // Already in Archived-students?
  const parents = studentFile.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === archived.getId()) return studentFile;
  }
  archived.addFile(studentFile);
  const remove = studentFile.getParents();
  while (remove.hasNext()) {
    const p = remove.next();
    if (p.getId() !== archived.getId()) p.removeFile(studentFile);
  }
  return studentFile;
}

/**
 * Inverse of archiveStudentSheetForGroup_. Move a per-student Sheet
 * out of <class>/Archived-students/ and back to <class>/. Idempotent.
 * Returns null if the archived file doesn't exist.
 */
function restoreStudentSheetFromArchive_(email, project) {
  const roster = getStudentRosterEntry_(email);
  if (!roster) return null;
  const projectFolder = DriveApp.getFolderById(project.rootFolderId);
  const classFolder = findChildFolder_(projectFolder, roster.Class);
  if (!classFolder) return null;
  const archived = findChildFolder_(classFolder, NAMES.ARCHIVED_STUDENTS_FOLDER);
  if (!archived) return null;
  const file = findChildFile_(archived, String(email).toLowerCase());
  if (!file) return null;
  // Move to class folder root.
  classFolder.addFile(file);
  archived.removeFile(file);
  // Clear Meta.groupId on the restored Sheet.
  try {
    const ss = SpreadsheetApp.openById(file.getId());
    setSoloMetaGroupId_(ss, '');
  } catch (e) { /* tolerate — caller can audit if needed */ }
  return file;
}

/**
 * Move a group Sheet itself into <class>/Archived-students/. Called on
 * disband. Idempotent.
 */
function archiveGroupSheet_(groupFile, classFolder) {
  return archiveStudentSheetForGroup_(groupFile, classFolder);
}

/**
 * Mark a member's row leftAt to "now" on the group's Members tab. Returns
 * true if a row was updated; false if no current row was found.
 */
function markMemberLeftAt_(groupSpreadsheet, email) {
  const tab = getTab_(groupSpreadsheet, TABS.GROUP_MEMBERS);
  if (tab.getLastRow() < 2) return false;
  const target = String(email).toLowerCase();
  const values = tab.getRange(2, 1, tab.getLastRow() - 1, HEADERS.GROUP_MEMBERS.length).getValues();
  const emailCol = HEADERS.GROUP_MEMBERS.indexOf('email');
  const leftCol  = HEADERS.GROUP_MEMBERS.indexOf('leftAt');
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][emailCol]).toLowerCase() === target && !String(values[i][leftCol] || '').trim()) {
      tab.getRange(i + 2, leftCol + 1).setValue(nowIso_());
      return true;
    }
  }
  return false;
}

/** Append a current-member row to the Members tab. */
function appendMemberToGroup_(groupSpreadsheet, rosterEntry) {
  const tab = getTab_(groupSpreadsheet, TABS.GROUP_MEMBERS);
  appendRow_(tab, HEADERS.GROUP_MEMBERS, {
    email:     String(rosterEntry.Email || '').toLowerCase(),
    firstName: String(rosterEntry.First || ''),
    lastName:  String(rosterEntry.Last  || ''),
    joinedAt:  nowIso_(),
    leftAt:    '',
  });
}

/**
 * Compute the next `Group N` placeholder for (project, class).
 * Counts current groups in the class and returns N = count + 1.
 */
function nextGroupPlaceholderName_(project, className) {
  const groups = listGroupsForProject_(project, className);
  return 'Group ' + (groups.length + 1);
}
