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
// Preheated map of every current group member in a project to that group's
// sheetId. Populated lazily on the first `findGroupSheetForStudent_` call
// per request from `listGroupsForProject_`. Without this, every solo
// student in the dashboard would walk the class folder and open every
// group Sheet just to confirm they're not in any of them (O(students ×
// groups) Sheet opens; trivial to blow past the 6-minute execution cap).
let _groupMemberMap = null;  // emailLower → sheetId (per project per request)

// Cross-request membership cache (CacheService). Every doPost / sidebar write
// used to pay the full listGroupsForProject_ Drive walk (O(files in project))
// just to route to a group Sheet — even in projects with zero groups. The
// email→sheetId map is tiny and changes only on teacher-driven group
// mutations, so it's cached for GROUP_CACHE_TTL_SECS under a generation
// token: resetGroupSheetCache_ (already called by every group mutation AND
// every dev-test fixture step) mints a new token, instantly invalidating all
// projects' cached maps. The TTL is a hard bound on staleness if a bust ever
// fails (CacheService hiccup).
var GROUP_CACHE_TTL_SECS = 300;

function groupCacheGen_() {
  const cache = CacheService.getScriptCache();
  let gen = cache.get('grp:gen');
  if (!gen) {
    gen = String(Date.now()) + ':' + Math.floor(Math.random() * 1e9);
    cache.put('grp:gen', gen, 21600); // 6h; re-minted lazily on expiry
  }
  return gen;
}

/**
 * Clear the request-scoped caches AND invalidate the cross-request
 * membership cache for every project (generation bump). Call from entry
 * points if needed; every group mutation must call this.
 */
function resetGroupSheetCache_() {
  _groupSheetCache = {};
  _groupMemberMap = null;
  try {
    const cache = CacheService.getScriptCache();
    cache.put('grp:gen', String(Date.now()) + ':' + Math.floor(Math.random() * 1e9), 21600);
  } catch (e) {
    // Cache unavailable: stale maps die on their own TTL (bounded staleness).
  }
}

/**
 * Find the active group Sheet for (student, project), or null.
 *
 * Strategy:
 *   1. Per-(email,project) cache hit → return.
 *   2. First call this request: preheat `_groupMemberMap` by walking
 *      `listGroupsForProject_` once. That opens each group Sheet once
 *      (unavoidable — we need the Members tab) and indexes all current
 *      members.
 *   3. Subsequent calls are pure dictionary lookups against the map.
 *
 * Worst-case Sheet opens: O(groups) per request, regardless of how many
 * students the caller resolves. Solo students require 0 additional opens
 * after the preheat.
 */
function findGroupSheetForStudent_(actorEmail, project) {
  if (!actorEmail || !project) return null;
  if (_groupSheetCache === null) _groupSheetCache = {};
  const cacheKey = String(actorEmail).toLowerCase() + '|' + project.projectId;
  if (cacheKey in _groupSheetCache) {
    return _groupSheetCache[cacheKey] || null;
  }

  // Preheat the project's email→sheetId map once per request — from the
  // cross-request cache when fresh (the common case for student writes),
  // falling back to the full Drive walk on a miss and repopulating.
  if (_groupMemberMap === null) {
    const mapKey = 'grp:v1:' + groupCacheGen_() + ':' + project.projectId;
    let cached = null;
    try { cached = CacheService.getScriptCache().get(mapKey); } catch (e) {}
    if (cached !== null) {
      try { _groupMemberMap = JSON.parse(cached); } catch (e) { _groupMemberMap = null; }
    }
    if (_groupMemberMap === null) {
      _groupMemberMap = {};
      const groups = listGroupsForProject_(project);
      groups.forEach((g) => {
        (g.memberEmails || []).forEach((e) => {
          _groupMemberMap[String(e).toLowerCase()] = g.sheetId;
        });
      });
      try {
        CacheService.getScriptCache().put(mapKey, JSON.stringify(_groupMemberMap), GROUP_CACHE_TTL_SECS);
      } catch (e) {}
    }
  }

  const target = String(actorEmail).toLowerCase();
  if (_groupMemberMap[target]) {
    try {
      const ss = SpreadsheetApp.openById(_groupMemberMap[target]);
      _groupSheetCache[cacheKey] = ss;
      return ss;
    } catch (e) {
      // sheetId stale (group disbanded mid-request); fall through to null.
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
var GROUPS_LIST_CACHE_TTL_SEC = 600;

function listGroupsForProject_(project, classFilter) {
  // The Drive walk + one openById per group Sheet is the single most expensive
  // step on every STUDENT read/write (findGroupSheetForStudent_ preheats from
  // it just to learn the student is solo). Cache the unfiltered listing per
  // project under the sheet-ref version (05_cache.js) — every group mutation
  // runs inside withGroupLock_, which bumps that version.
  const all = cachedJson_(groupsListKey_(project.projectId), GROUPS_LIST_CACHE_TTL_SEC,
    () => listGroupsForProjectLive_(project));
  if (!classFilter) return all;
  return all.filter((g) => g.className === classFilter);
}

function listGroupsForProjectLive_(project) {
  const out = [];
  const classFilter = null;
  const projectFolder = DriveApp.getFolderById(project.rootFolderId);
  const classFolders = projectFolder.getFolders();
  while (classFolders.hasNext()) {
    const cf = classFolders.next();
    if (cf.getName() === NAMES.ARCHIVED_FOLDER) continue;          // project-level archive
    if (cf.getName() === NAMES.ARCHIVED_STUDENTS_FOLDER) continue; // not a class
    if (classFilter && cf.getName() !== classFilter) continue;
    const files = cf.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      // getFiles() includes trashed files; a trashed [grp] sheet (e.g. a
      // failed-merge rollback, or leftover dev-test cleanup) is NOT an active
      // group and must not be opened — accessing a pending-purge doc throws
      // "Service Spreadsheets failed".
      if (f.isTrashed()) continue;
      const name = f.getName();
      if (name.indexOf(NAMES.GROUP_SHEET_PREFIX) !== 0) continue;
      try {
        const ss = SpreadsheetApp.openById(f.getId());
        const meta = readGroupMeta_(ss);
        if (!meta || !meta.groupId) continue;
        if (meta.projectId !== project.projectId) continue;
        const current = currentMembers_(ss);
        out.push({
          groupId: meta.groupId,
          name: String(meta.studentName || '').replace(/^\[grp\] /, ''),
          className: cf.getName(),
          sheetId: f.getId(),
          // Tab gids for the dashboard's CSV-export reader (we already have the
          // Spreadsheet open here — capturing them is free).
          sourcesGid: tabGid_(ss, TABS.SOURCES),
          highlightsGid: tabGid_(ss, TABS.HIGHLIGHTS),
          memberEmails: current.map((m) => m.email),
          memberCount: current.length,
        });
      } catch (e) {
        // A single unreadable group Sheet must not abort the whole walk.
        continue;
      }
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
    if (cf.getName() === NAMES.ARCHIVED_FOLDER) continue;  // project-level archive
    // Include the active class folder AND the Archived-students subfolder
    // (so disband / cleanup operations can find archived group Sheets too).
    const candidates = [cf];
    const archived = findChildFolder_(cf, NAMES.ARCHIVED_STUDENTS_FOLDER);
    if (archived) candidates.push(archived);
    for (let i = 0; i < candidates.length; i++) {
      const files = candidates[i].getFiles();
      while (files.hasNext()) {
        const f = files.next();
        if (f.isTrashed()) continue;  // skip trashed [grp] sheets (see listGroupsForProject_)
        if (f.getName().indexOf(NAMES.GROUP_SHEET_PREFIX) !== 0) continue;
        try {
          const ss = SpreadsheetApp.openById(f.getId());
          const meta = readGroupMeta_(ss);
          if (meta && meta.groupId === groupId) {
            return { file: f, spreadsheet: ss, classFolder: cf, parent: candidates[i] };
          }
        } catch (e) {
          continue;
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
  file.moveTo(classFolder);

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
 * Move a per-student Sheet from its class folder into the class's
 * Archived-students/ subfolder. Idempotent: no-op if already archived.
 * Still used to stash the GROUP Sheet itself on disband (archiveGroupSheet_).
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
  studentFile.moveTo(archived);
  return studentFile;
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
 *
 * Counts files whose name starts with the group prefix in the class
 * folder. Deliberately does NOT call `listGroupsForProject_` — that
 * opens every group's Sheet to read Meta/Members. For a placeholder
 * that the teacher will probably override anyway, walking the file
 * list once is enough.
 */
function nextGroupPlaceholderName_(project, className) {
  const projectFolder = DriveApp.getFolderById(project.rootFolderId);
  const classFolder = findChildFolder_(projectFolder, className);
  if (!classFolder) return 'Group 1';
  let count = 0;
  const files = classFolder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    if (f.isTrashed()) continue;  // don't count trashed [grp] sheets toward the next number
    if (f.getName().indexOf(NAMES.GROUP_SHEET_PREFIX) === 0) count++;
  }
  return 'Group ' + (count + 1);
}

// ============================================================
// Reconstruct-based un-merge, locking, add-to-group
// ------------------------------------------------------------
// The group Sheet is the single source of truth for a member's work while
// grouped: it holds their pre-merge rows (copied in at merge) plus anything
// they authored in the group, all stamped with their createdByEmail. So
// un-merge rebuilds a member's solo Sheet by filtering the group's rows on
// createdByEmail (+ the referential closure of sources their highlights cite)
// rather than restoring a stale pre-merge snapshot. Their group-period work
// follows them out.
// ============================================================

/**
 * Serialize a group mutation against concurrent student writes / other
 * teacher actions. 30s is generous for a deliberate, low-frequency action.
 */
function withGroupLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    // Every group mutation re-points at least one student's Sheet (merge /
    // move / add / remove / disband). Bump the cross-request resolution
    // version so no cached (student → sheetId) or group listing outlives it —
    // a stale hit here would route a student's write into a trashed solo
    // Sheet. Done in finally: a partial mutation must invalidate too.
    bumpSheetRefVersion_();
    lock.releaseLock();
  }
}

/**
 * Rebuild a member's SOLO Sheet from a group's rows: their highlights, plus
 * every Source those highlights reference (even if authored by a teammate
 * after a manual dedup) plus any Source they authored. Rows are written
 * verbatim by key — NOT through upsertSource_, which would re-stringify the
 * already-serialized citationFields. Returns { sources, highlights, soloId }.
 */
function reconstructSoloFromGroup_(project, groupSpreadsheet, email) {
  const e = String(email).toLowerCase();
  const allHl = readAllAsObjects_(getTab_(groupSpreadsheet, TABS.HIGHLIGHTS), HEADERS.HIGHLIGHTS);
  const myHl = allHl.filter((h) => String(h.createdByEmail).toLowerCase() === e);
  const needSrc = {};
  myHl.forEach((h) => { if (h.sourceId) needSrc[h.sourceId] = true; });
  const allSrc = readAllAsObjects_(getTab_(groupSpreadsheet, TABS.SOURCES), HEADERS.SOURCES);
  const mySrc = allSrc.filter((s) => String(s.createdByEmail).toLowerCase() === e || needSrc[s.sourceId]);

  const solo = findOrCreateSoloSheet_(e, project);  // SOLO core — bypasses group routing
  const srcTab = getTab_(solo, TABS.SOURCES);
  const hlTab  = getTab_(solo, TABS.HIGHLIGHTS);
  mySrc.forEach((s) => upsertByKey_(srcTab, HEADERS.SOURCES, 'sourceId', s));
  myHl.forEach((h) => upsertByKey_(hlTab, HEADERS.HIGHLIGHTS, 'highlightId', h));
  return { sources: mySrc.length, highlights: myHl.length, soloId: solo.getId() };
}

/**
 * Reconstruct each current member's solo Sheet from the group, mark them
 * left, archive the (now-redundant) group Sheet, audit. Caller holds the
 * lock. Returns { ok, groupId, restoredCount }.
 */
function disbandGroupCore_(project, group, actorEmail) {
  const groupSs = group.spreadsheet;
  const members = currentMembers_(groupSs);
  members.forEach((m) => {
    reconstructSoloFromGroup_(project, groupSs, m.email);
    markMemberLeftAt_(groupSs, m.email);
    appendAuditEvent_({
      projectId: project.projectId, action: AUDIT_ACTIONS.GROUP_DISBAND,
      actor: actorEmail, detail: 'groupId=' + group.groupId + ';email=' + m.email,
    });
  });
  try { archiveGroupSheet_(group.file, group.classFolder); } catch (e) { /* best-effort */ }
  appendAuditEvent_({
    projectId: project.projectId, action: AUDIT_ACTIONS.GROUP_DISBAND_GROUP,
    actor: actorEmail, detail: 'groupId=' + group.groupId,
  });
  return { ok: true, groupId: group.groupId, restoredCount: members.length };
}

/**
 * Remove one member: reconstruct their solo from the group, strip their rows
 * from the group (deleting a Source only once no highlight references it, so
 * a teammate's highlight is never orphaned), mark them left. If ≤1 member
 * would remain, auto-disband (a one-person group is just a solo student).
 * Caller holds the lock.
 */
function removeMemberFromGroupCore_(project, group, email, actorEmail) {
  const e = String(email).toLowerCase();
  const groupSs = group.spreadsheet;
  const rebuilt = reconstructSoloFromGroup_(project, groupSs, e);

  const touched = {};
  readAllAsObjects_(getTab_(groupSs, TABS.HIGHLIGHTS), HEADERS.HIGHLIGHTS)
    .filter((h) => String(h.createdByEmail).toLowerCase() === e)
    .forEach((h) => { const sid = deleteHighlightById_(groupSs, h.highlightId); if (sid) touched[sid] = true; });
  readAllAsObjects_(getTab_(groupSs, TABS.SOURCES), HEADERS.SOURCES)
    .filter((s) => String(s.createdByEmail).toLowerCase() === e)
    .forEach((s) => { touched[s.sourceId] = true; });
  Object.keys(touched).forEach((sid) => deleteSourceIfOrphaned_(groupSs, sid));

  markMemberLeftAt_(groupSs, e);
  appendAuditEvent_({
    projectId: project.projectId, action: AUDIT_ACTIONS.GROUP_UNMERGE,
    actor: actorEmail, detail: 'groupId=' + group.groupId + ';email=' + e,
  });

  const remaining = currentMembers_(groupSs);
  if (remaining.length <= 1) {
    remaining.forEach((m) => {
      reconstructSoloFromGroup_(project, groupSs, m.email);
      markMemberLeftAt_(groupSs, m.email);
    });
    try { archiveGroupSheet_(group.file, group.classFolder); } catch (err) { /* best-effort */ }
    appendAuditEvent_({
      projectId: project.projectId, action: AUDIT_ACTIONS.GROUP_DISBAND_GROUP,
      actor: actorEmail, detail: 'groupId=' + group.groupId + ';autoDisbanded=true',
    });
    return { ok: true, removed: e, rebuilt, autoDisbanded: true };
  }
  return { ok: true, removed: e, rebuilt, remaining: remaining.map((m) => m.email) };
}

/**
 * Add an ungrouped member to an existing group: copy their solo rows in
 * verbatim, trash the solo Sheet, append the Members row. Caller holds the
 * lock and has validated class / capacity / not-already-grouped. Returns
 * { ok, added, copiedSources, copiedHighlights }.
 */
function addMemberToGroupCore_(project, group, rosterEntry, actorEmail) {
  const e = String(rosterEntry.Email || '').toLowerCase();
  const groupSs = group.spreadsheet;
  // Capacity guard re-checked here, inside the lock — the endpoint's pre-lock
  // check is a TOCTOU window; this is the authoritative gate against a 5th
  // member slipping in via a concurrent add/move.
  if (currentMembers_(groupSs).length >= 4) {
    throw new Error('Group already has 4 members');
  }
  const soloFile = findChildFile_(group.classFolder, e);
  let copiedSources = 0, copiedHighlights = 0;
  if (soloFile) {
    const soloSs = SpreadsheetApp.openById(soloFile.getId());
    const copied = copyMemberRowsIntoGroup_(groupSs, soloSs);
    copiedSources = copied.sourcesCopied;
    copiedHighlights = copied.highlightsCopied;
  }
  // Establish membership BEFORE trashing the solo. If a later step throws, the
  // member's data still lives in their (un-trashed) solo Sheet rather than
  // only in a trashed one with no group row pointing at it.
  appendMemberToGroup_(groupSs, rosterEntry);
  if (soloFile) {
    DriveApp.getFileById(soloFile.getId()).setTrashed(true);
    forgetSoloSheetId_(project.projectId, e);   // solo Sheet is gone — drop its dashboard-manifest entry
  }
  appendAuditEvent_({
    projectId: project.projectId, action: AUDIT_ACTIONS.GROUP_MERGE,
    actor: actorEmail, detail: 'add;groupId=' + group.groupId + ';email=' + e,
  });
  return { ok: true, added: e, copiedSources, copiedHighlights };
}
