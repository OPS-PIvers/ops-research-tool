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
  const all = withMemberClasses_(project, cachedJson_(groupsListKey_(project.projectId), GROUPS_LIST_CACHE_TTL_SEC,
    () => listGroupsForProjectLive_(project)));
  if (!classFilter) return all;
  return all.filter((g) => g.memberClasses.indexOf(classFilter) >= 0);
}

// ============================================================
// Cross-period groups
// ------------------------------------------------------------
// A group's Sheet lives in ONE class folder (its "home", g.className), but
// its members may come from any of the project's classes. Everything that
// decides where a group shows or who may manage it uses the classes its
// members are in (g.memberClasses), never the home folder. Enrollment is
// read at request time (the roster is cached separately), so the cached
// group listing never goes stale when a student's classes change.
// ============================================================

/** A student's classes that are in the project, sorted. */
function projectClassesForStudent_(email, project) {
  const pc = projectClassList_(project);
  return getStudentClasses_(String(email).toLowerCase()).filter((c) => pc.indexOf(c) >= 0).sort();
}

/**
 * Annotate group listings with memberClassMap ({email: [project classes]})
 * and memberClasses (their sorted union). Falls back to the home class when
 * no member is enrolled anywhere (so an orphaned group stays visible where
 * it was filed). Returns new objects; the cached listing isn't mutated.
 */
function withMemberClasses_(project, groups) {
  return (groups || []).map((g) => {
    const map = {};
    (g.memberEmails || []).forEach((e) => {
      map[String(e).toLowerCase()] = projectClassesForStudent_(e, project);
    });
    return Object.assign({}, g, {
      memberClassMap: map,
      memberClasses: unionMemberClasses_(map, g.className),
    });
  });
}

/** Pure: sorted union of a memberClassMap's lists, else [fallbackClass]. */
function unionMemberClasses_(memberClassMap, fallbackClass) {
  const seen = {};
  Object.keys(memberClassMap || {}).forEach((e) => {
    (memberClassMap[e] || []).forEach((c) => { if (c) seen[c] = true; });
  });
  const out = Object.keys(seen).sort();
  return out.length ? out : (fallbackClass ? [fallbackClass] : []);
}

/**
 * Pure: may a non-admin teacher put these students in one group? Yes when
 * the teacher teaches at least one project class of EVERY student. Admins
 * skip this check. `memberClassLists` = [[classes of student 1], ...].
 */
function teacherCanGroupMembers_(taughtClasses, memberClassLists) {
  const taught = taughtClasses || [];
  return (memberClassLists || []).every((list) =>
    (list || []).some((c) => taught.indexOf(c) >= 0));
}

/** Pure: does the teacher teach any class a group's members are in? */
function teacherCanSeeGroup_(taughtClasses, group) {
  const taught = taughtClasses || [];
  return ((group && group.memberClasses) || []).some((c) => taught.indexOf(c) >= 0);
}

/**
 * Pure: the class folder a new group's Sheet is filed under. The first
 * (sorted) member class the actor teaches, so a teacher's group lands in
 * their own section; admins (taught = null) get the first member class.
 */
function chooseGroupHomeClass_(memberClassLists, taughtClasses) {
  const union = unionMemberClasses_(
    (memberClassLists || []).reduce((m, list, i) => { m[i] = list; return m; }, {}), '');
  if (!taughtClasses) return union[0] || '';
  return union.find((c) => taughtClasses.indexOf(c) >= 0) || union[0] || '';
}

/**
 * Member classes of a located group (findGroupFileByGroupId_), from its live
 * Members tab: { memberClassMap, memberClasses }. Used for authorization.
 */
function locatedGroupClasses_(project, located) {
  const map = {};
  currentMembers_(located.spreadsheet).forEach((m) => {
    map[String(m.email).toLowerCase()] = projectClassesForStudent_(m.email, project);
  });
  return { memberClassMap: map, memberClasses: unionMemberClasses_(map, located.classFolder.getName()) };
}

/** Throw unless a non-admin teacher teaches a class one of the group's members is in. */
function assertTeacherSeesGroup_(staff, actorEmail, project, located) {
  if (isAdmin_(staff)) return;
  const taught = listClassesTaughtBy_(actorEmail);
  if (!teacherCanSeeGroup_(taught, locatedGroupClasses_(project, located))) {
    throw new Error('Class not in your scope');
  }
}

/**
 * Throw unless a non-admin teacher teaches a class of every one of `emails`
 * (the group's resulting membership).
 */
function assertTeacherCanGroup_(staff, actorEmail, project, emails) {
  if (isAdmin_(staff)) return;
  const taught = listClassesTaughtBy_(actorEmail);
  const lists = emails.map((e) => projectClassesForStudent_(e, project));
  if (!teacherCanGroupMembers_(taught, lists)) {
    throw new Error('You can only group students in sections you teach');
  }
}

/**
 * Look up a group by id with its member classes (for authorization). Uses
 * the cached listing; null if absent.
 */
function groupWithClasses_(project, groupId) {
  return listGroupsForProject_(project).find((g) => g.groupId === groupId) || null;
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
 * Throws on the first violation. No Sheet writes. Returns
 * { rosters, memberClassLists, lowered, trimmedName }.
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
  // Roster check + each member must be in at least one of the project's
  // classes. Members may come from different classes (cross-period groups);
  // who may group them is checked by the caller (teacherCanGroupMembers_).
  const rosters = lowered.map((e) => {
    const r = getStudentRosterEntry_(e);
    if (!r) throw new Error('Not on roster: ' + e);
    return r;
  });
  const memberClassLists = lowered.map((e) => {
    const list = projectClassesForStudent_(e, project);
    if (!list.length) throw new Error(e + ' is not in a class enrolled in this project');
    return list;
  });
  // Not already in a group in this project.
  lowered.forEach((e) => {
    const existing = findGroupSheetForStudent_(e, project);
    if (existing) {
      throw new Error(e + ' is already in a group — move them out first');
    }
  });
  return { rosters, memberClassLists, lowered, trimmedName };
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
 * How a joining student's existing solo work is handled when they join a group.
 *   combine — their sources + highlights are copied into the group Sheet and
 *             the solo Sheet is trashed (the group Sheet is the sole store).
 *   fresh   — the group starts without their work. The solo Sheet is set aside
 *             in <class>/Archived-students/ with Meta.groupId stamped, and is
 *             restored to them if they later leave the group.
 */
var GROUP_JOIN_MODES = { COMBINE: 'combine', FRESH: 'fresh' };

/** Anything other than an explicit 'fresh' combines (the historical behavior). */
function normalizeGroupJoinMode_(mode) {
  return String(mode || '').trim().toLowerCase() === GROUP_JOIN_MODES.FRESH
    ? GROUP_JOIN_MODES.FRESH : GROUP_JOIN_MODES.COMBINE;
}

/**
 * Pure: the rows whose `keyCol` value is not already in `existingKeys`
 * (an array of key values), also dropping repeats within `rows`. Makes a
 * solo → group copy safe to run twice.
 */
function rowsNotYetIn_(rows, keyCol, existingKeys) {
  const seen = {};
  (existingKeys || []).forEach((k) => { seen[String(k)] = true; });
  return (rows || []).filter((r) => {
    const k = String(r[keyCol] === undefined ? '' : r[keyCol]);
    if (!k || seen[k]) return false;
    seen[k] = true;
    return true;
  });
}

/** Student-edited Source fields — the work a scrape-only re-assert lacks. */
var SOURCE_STUDENT_FIELDS = ['sourceType', 'citationFields', 'primarySecondary', 'annotation', 'annotationLastEdited'];

function isBlankSourceField_(field, value) {
  const v = String(value === undefined || value === null ? '' : value).trim();
  if (!v) return true;
  if (field === 'citationFields') return v === '{}';
  if (field === 'primarySecondary') return v === 'unset';
  return false;
}

/**
 * Pure: when the group already holds a Source with the solo row's sourceId
 * (the extension re-asserted a cached source id into the group after the
 * merge, carrying only scraped fields), fill each blank student-edited field
 * from the solo row. Never overwrites a non-blank group value. Returns the
 * merged row, or null when nothing would change.
 */
function fillBlankSourceFields_(groupRow, soloRow) {
  const merged = Object.assign({}, groupRow);
  let changed = false;
  SOURCE_STUDENT_FIELDS.forEach((f) => {
    if (isBlankSourceField_(f, groupRow[f]) && !isBlankSourceField_(f, soloRow[f])) {
      merged[f] = soloRow[f];
      changed = true;
    }
  });
  return changed ? merged : null;
}

/**
 * Bulk copy all Sources + Highlights rows from a per-student Sheet into a
 * group Sheet. Rows are inserted as-is — sourceId, highlightId,
 * createdByEmail, createdAt, projectId all preserved. Rows whose id is already
 * in the group are skipped, so re-running (e.g. the stranded-work repair) never
 * duplicates. A Source already in the group (same id) gets its blank
 * student-edited fields filled from the solo row (fillBlankSourceFields_).
 *
 * Returns { sourcesCopied, highlightsCopied, sourcesMerged? }.
 */
function copyMemberRowsIntoGroup_(groupSpreadsheet, studentSpreadsheet) {
  const out = { sourcesCopied: 0, highlightsCopied: 0 };

  [TABS.SOURCES, TABS.HIGHLIGHTS].forEach((tabName) => {
    const headers = (tabName === TABS.SOURCES) ? HEADERS.SOURCES : HEADERS.HIGHLIGHTS;
    const keyCol  = (tabName === TABS.SOURCES) ? 'sourceId' : 'highlightId';
    const fromTab = studentSpreadsheet.getSheetByName(tabName);
    if (!fromTab) return;
    const toTab = getTab_(groupSpreadsheet, tabName);
    const existingRows = readAllAsObjects_(toTab, headers);
    const fromRows = readAllAsObjects_(fromTab, headers);
    if (tabName === TABS.SOURCES && existingRows.length) {
      // Same sourceId already in the group: keep the group row, but fill its
      // blank citation / annotation / classification from the solo copy.
      const at = {};
      existingRows.forEach((r, i) => { at[String(r.sourceId)] = i; });
      fromRows.forEach((r) => {
        const i = at[String(r.sourceId)];
        if (i === undefined) return;
        const merged = fillBlankSourceFields_(existingRows[i], r);
        if (!merged) return;
        toTab.getRange(i + 2, 1, 1, headers.length)
          .setValues([headers.map((h) => merged[h] === undefined ? '' : merged[h])]);
        out.sourcesMerged = (out.sourcesMerged || 0) + 1;
      });
    }
    const rows = rowsNotYetIn_(fromRows, keyCol, existingRows.map((r) => r[keyCol]));
    if (rows.length === 0) return;
    const matrix = rows.map((row) => headers.map((h) => row[h] === undefined ? '' : row[h]));
    toTab.getRange(toTab.getLastRow() + 1, 1, matrix.length, headers.length).setValues(matrix);
    if (tabName === TABS.SOURCES) out.sourcesCopied += rows.length;
    else                          out.highlightsCopied += rows.length;
  });

  return out;
}

/** Write Meta.groupId on a Sheet's single Meta row (solo or group). */
function setSheetMetaGroupId_(ss, groupId) {
  const tab = ss.getSheetByName(TABS.META);
  if (!tab || tab.getLastRow() < 2) return;
  tab.getRange(2, HEADERS.META.indexOf('groupId') + 1).setValue(groupId || '');
}

/**
 * Handle a joining member's solo Sheet per `mode` (see GROUP_JOIN_MODES).
 * Call AFTER the member's Members row exists, so their writes already route to
 * the group: a failure partway leaves the solo Sheet live and untouched
 * (recoverable with devRepairStrandedGroupWork), never trashed with its rows
 * missing from the group. Caller holds the group lock.
 *
 * Returns { soloFound, sourcesCopied, highlightsCopied, setAside }.
 */
function absorbSoloIntoGroup_(project, groupSpreadsheet, groupId, email, mode) {
  const e = String(email).toLowerCase();
  const out = { soloFound: false, sourcesCopied: 0, highlightsCopied: 0, setAside: false };
  const soloFile = findSoloSheetFileInProject_(e, project);
  if (!soloFile) return out;   // never highlighted — nothing to bring in or set aside
  out.soloFound = true;
  const soloSs = SpreadsheetApp.openById(soloFile.getId());
  if (normalizeGroupJoinMode_(mode) === GROUP_JOIN_MODES.COMBINE) {
    const copied = copyMemberRowsIntoGroup_(groupSpreadsheet, soloSs);
    out.sourcesCopied = copied.sourcesCopied;
    out.highlightsCopied = copied.highlightsCopied;
  }
  out.setAside = finalizeJoinedSoloSheet_(project, soloFile, soloSs, groupId, e, mode);
  return out;
}

/**
 * Second half of a join, run only once the member's rows are safely in the
 * group (combine) or nothing needs copying (fresh): combine trashes the solo
 * Sheet; fresh stamps Meta.groupId and moves it into <class>/Archived-students/.
 * Either way it leaves the class root, so its manifest entry is dropped.
 * Returns true when the Sheet was set aside (fresh).
 */
function finalizeJoinedSoloSheet_(project, soloFile, soloSs, groupId, email, mode) {
  let setAside = false;
  if (normalizeGroupJoinMode_(mode) === GROUP_JOIN_MODES.FRESH) {
    // Stamp which group set it aside, so only leaving THIS group restores it.
    setSheetMetaGroupId_(soloSs, groupId);
    const parents = soloFile.getParents();
    const classFolder = parents.hasNext() ? parents.next() : null;
    if (classFolder) archiveStudentSheetForGroup_(soloFile, classFolder);
    setAside = true;
  } else {
    soloFile.setTrashed(true);
  }
  forgetSoloSheetId_(project.projectId, String(email).toLowerCase());
  return setAside;
}

/**
 * If `email` joined `groupId` with "Start fresh", move their set-aside solo
 * Sheet from Archived-students/ back into its class folder and clear the
 * stamp, so leaving the group gives them back their pre-group work. Only a
 * Sheet stamped with THIS groupId is restored. Returns true if one was.
 */
function restoreSetAsideSoloSheet_(project, email, groupId) {
  if (!groupId) return false;
  const projectFolder = DriveApp.getFolderById(project.rootFolderId);
  const folders = projectFolder.getFolders();
  while (folders.hasNext()) {
    const cf = folders.next();
    const nm = cf.getName();
    if (nm === NAMES.ARCHIVED_FOLDER || nm === NAMES.ARCHIVED_STUDENTS_FOLDER) continue;
    const archived = findChildFolder_(cf, NAMES.ARCHIVED_STUDENTS_FOLDER);
    if (!archived) continue;
    const files = archived.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      if (f.isTrashed() || !soloSheetNameMatches_(f.getName(), email)) continue;
      const ss = SpreadsheetApp.openById(f.getId());
      const meta = readGroupMeta_(ss);
      if (!meta || String(meta.groupId || '') !== String(groupId)) continue;
      // Don't create a second live solo if one already exists.
      if (findSoloSheetFileInProject_(email, project)) return false;
      f.moveTo(cf);
      setSheetMetaGroupId_(ss, '');
      return true;
    }
  }
  return false;
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

  // A member who joined with "Start fresh" gets their set-aside pre-group
  // Sheet back; their group-period rows are then upserted on top of it.
  const groupMeta = readGroupMeta_(groupSpreadsheet);
  restoreSetAsideSoloSheet_(project, e, groupMeta && groupMeta.groupId);

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
 * Add an ungrouped member to an existing group: append the Members row, then
 * handle their solo Sheet per `mode` (default combine: copy rows in, trash the
 * solo; see absorbSoloIntoGroup_). Caller holds the
 * lock and has validated class / capacity / not-already-grouped. Returns
 * { ok, added, copiedSources, copiedHighlights }.
 */
function addMemberToGroupCore_(project, group, rosterEntry, actorEmail, mode) {
  const e = String(rosterEntry.Email || '').toLowerCase();
  const groupSs = group.spreadsheet;
  // Capacity guard re-checked here, inside the lock — the endpoint's pre-lock
  // check is a TOCTOU window; this is the authoritative gate against a 5th
  // member slipping in via a concurrent add/move.
  if (currentMembers_(groupSs).length >= 4) {
    throw new Error('Group already has 4 members');
  }
  // Establish membership BEFORE touching the solo Sheet. If a later step
  // throws, the member's data still lives in their (un-trashed) solo Sheet
  // rather than only in a trashed one with no group row pointing at it.
  appendMemberToGroup_(groupSs, rosterEntry);
  const absorbed = absorbSoloIntoGroup_(project, groupSs, group.groupId, e, mode);
  const copiedSources = absorbed.sourcesCopied;
  const copiedHighlights = absorbed.highlightsCopied;
  appendAuditEvent_({
    projectId: project.projectId, action: AUDIT_ACTIONS.GROUP_MERGE,
    actor: actorEmail,
    detail: 'add;groupId=' + group.groupId + ';email=' + e + ';mode=' + normalizeGroupJoinMode_(mode),
  });
  return { ok: true, added: e, copiedSources, copiedHighlights };
}

// ============================================================
// Stranded-work repair (editor-run)
// ------------------------------------------------------------
// Until 2026-11-11 merge/add looked up each member's solo Sheet by an exact
// filename equal to their email. Solo Sheets are named
// "<project> — Research — <email>", so the lookup missed: the member joined
// the group, but their pre-merge work stayed behind in a live solo Sheet the
// group never saw. These find (dry run) and fix (copy in + trash the solo)
// every such member across active projects. Safe to re-run: the copy skips
// ids already in the group.
// ============================================================

/** Dry run — logs every group member who still has a live solo Sheet. */
function devFindStrandedGroupWork() {
  return strandedGroupWork_(false);
}

/** Copies stranded solo work into each member's group and trashes the solo Sheet. */
function devRepairStrandedGroupWork() {
  return strandedGroupWork_(true);
}

function strandedGroupWork_(apply) {
  const actor = getActorEmail_();
  assertAdmin_(actor);
  const found = [];
  listActiveProjects_().forEach((project) => {
    listGroupsForProjectLive_(project).forEach((g) => {
      (g.memberEmails || []).forEach((email) => {
        const e = String(email).toLowerCase();
        const soloFile = findSoloSheetFileInProject_(e, project);
        if (!soloFile) return;
        const soloSs = SpreadsheetApp.openById(soloFile.getId());
        const groupSs = SpreadsheetApp.openById(g.sheetId);
        const count = (ss, tab, headers) => readAllAsObjects_(getTab_(ss, tab), headers);
        const soloSrc = count(soloSs, TABS.SOURCES, HEADERS.SOURCES);
        const soloHl  = count(soloSs, TABS.HIGHLIGHTS, HEADERS.HIGHLIGHTS);
        const grpSrcIds = count(groupSs, TABS.SOURCES, HEADERS.SOURCES).map((r) => r.sourceId);
        const grpHlIds  = count(groupSs, TABS.HIGHLIGHTS, HEADERS.HIGHLIGHTS).map((r) => r.highlightId);
        const item = {
          project: project.name, projectId: project.projectId,
          group: g.name, groupId: g.groupId, className: g.className, email: e,
          soloSheetUrl: soloFile.getUrl(),
          soloSources: soloSrc.length, soloHighlights: soloHl.length,
          newSources: rowsNotYetIn_(soloSrc, 'sourceId', grpSrcIds).length,
          newHighlights: rowsNotYetIn_(soloHl, 'highlightId', grpHlIds).length,
        };
        if (apply) {
          withGroupLock_(() => {
            const r = absorbSoloIntoGroup_(project, groupSs, g.groupId, e, GROUP_JOIN_MODES.COMBINE);
            item.copiedSources = r.sourcesCopied;
            item.copiedHighlights = r.highlightsCopied;
            appendAuditEvent_({
              projectId: project.projectId, action: AUDIT_ACTIONS.GROUP_MERGE, actor: actor,
              detail: 'repair;groupId=' + g.groupId + ';email=' + e +
                ';sources=' + r.sourcesCopied + ';highlights=' + r.highlightsCopied,
            });
          });
        }
        found.push(item);
      });
    });
  });
  if (apply) resetGroupSheetCache_();
  Logger.log((apply ? 'REPAIRED ' : 'FOUND ') + found.length + ' stranded member(s)');
  found.forEach((f) => Logger.log(JSON.stringify(f)));
  return found;
}
