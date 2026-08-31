/**
 * Admin-only endpoints called from the Console via google.script.run.
 * All endpoints assertAdmin_() first; non-admin staff and non-staff
 * users are both rejected at the server, regardless of UI gating.
 *
 * This file grows over the sub-project. Order roughly: roster reads,
 * roster mutations, staff mutations, archive-year operations.
 */

/**
 * Full roster read with hasWork precomputation.
 *
 * hasWork[email] = true iff there exists a Sheet file whose name carries
 * `<email>` as a token (e.g. `<project> — Research — <email>`, or a legacy
 * bare `<email>`) inside any class folder under any project root
 * (active OR archived).
 *
 * Implementation: one Drive walk per call. For ~10 projects × ~5
 * classes × ~25 students that's ~1500 Drive items — handled in a few
 * seconds. The result is used to decide whether to require a
 * typed-confirm modal for row delete (Section 7.2 of spec).
 */
function adminGetRoster() {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  ensureClassSchema_();
  const workEmails = listAllStudentSheetEmails_();
  const classTeacherOf = {};
  listClasses_().forEach((c) => { classTeacherOf[c.Class] = c.TeacherEmail; });

  // One row per ENROLLMENT so a multi-class student appears once per class; a
  // student with no enrollments still shows (blank Class) so they're editable.
  const data = rosterData_();
  const enrollByEmail = {};
  data.enrollments.forEach((e) => {
    const em = String(e.Email).toLowerCase();
    (enrollByEmail[em] || (enrollByEmail[em] = [])).push(String(e.Class).trim());
  });
  const rows = [];
  excludeSampleIfDisabled_(data.students).forEach((s) => {
    const em = String(s.Email).toLowerCase();
    const classes = (enrollByEmail[em] && enrollByEmail[em].length) ? enrollByEmail[em] : [''];
    classes.forEach((cls) => {
      rows.push({
        ID: String(s.ID || ''),
        First: String(s.First || ''),
        Last: String(s.Last || ''),
        Email: em,
        Class: cls,
        Teacher: '',
        TeacherEmail: classTeacherOf[cls] || '',
        hasWork: workEmails[em] === true,
      });
    });
  });
  return { ok: true, rows };
}

/**
 * Build a {emailLower: true} map of every email that names a per-student
 * Sheet in any project's class folder. Walks Drive once.
 *
 * Returns the map (object) for O(1) lookups during the roster
 * enrichment pass in adminGetRoster.
 */
function listAllStudentSheetEmails_() {
  const out = {};
  const root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);

  // Active project folders live under root. Archived ones live under
  // root/Archived/. We walk both.
  const projectFolders = [];
  const directKids = root.getFolders();
  while (directKids.hasNext()) {
    const f = directKids.next();
    if (f.getName() === NAMES.ARCHIVED_FOLDER) {
      const archivedKids = f.getFolders();
      while (archivedKids.hasNext()) projectFolders.push(archivedKids.next());
    } else {
      projectFolders.push(f);
    }
  }

  projectFolders.forEach((pf) => {
    const classFolders = pf.getFolders();
    while (classFolders.hasNext()) {
      const cf = classFolders.next();
      const files = cf.getFiles();
      while (files.hasNext()) {
        const fl = files.next();
        // Per-student Sheets carry the student email as a whitespace-delimited
        // token in the file name (`<project> — Research — <email>`, or a legacy
        // bare `<email>`). Key the map by that email token so it stays
        // email-keyed regardless of the surrounding name; group sheets
        // (`[grp] …`) have no @ token and are skipped.
        const email = fl.getName().toLowerCase().split(/\s+/)
          .find((t) => t.indexOf('@') > 0 && t.indexOf('.') > 0);
        if (email) out[email] = true;
      }
    }
  });

  return out;
}

// ============================================================
// Roster mutations
// ============================================================

/**
 * Add a student + enroll them in a class (Classes v2). Creates the class if it
 * doesn't exist yet (stamping the given teacher). Validates required fields,
 * email uniqueness (as a student), and ID uniqueness.
 *
 * `row` shape (input): {ID?, First, Last, Email, Class, Teacher?, TeacherEmail}
 * Returns { ok, row } with the canonicalized stored values.
 */
function adminAddRosterRow(row) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!row) throw new Error('row required');
  const out = canonicalizeRosterRow_(row, /*requireEmail=*/true);
  validateRosterRowOrThrow_(out);
  ensureClassSchema_();
  if (getStudentIdentity_(out.Email)) throw new Error('Email already in roster: ' + out.Email);
  if (out.ID && rosterData_().students.some((s) => String(s.ID || '').trim() === out.ID)) {
    throw new Error('ID already in roster: ' + out.ID);
  }
  upsertStudent_({ ID: out.ID, First: out.First, Last: out.Last, Email: out.Email });
  if (!getClassRecord_(out.Class)) createClass_(out.Class, out.TeacherEmail, '');
  enroll_(out.Email, out.Class);
  return { ok: true, row: out };
}

/**
 * Update a student's identity (First/Last). Class/teacher membership is managed
 * through the Classes endpoints (a student can be in several classes now), so
 * Class/Teacher edits are not accepted here. Email/ID go through dedicated
 * endpoints. Identified by Email.
 */
function adminUpdateRosterRow(email, fields) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!email) throw new Error('email required');
  if (!fields) throw new Error('fields required');
  const id = getStudentIdentity_(email);
  if (!id) throw new Error('Student not found: ' + email);
  const next = { ID: id.ID, First: id.First, Last: id.Last, Email: id.Email };
  let touched = false;
  if ('First' in fields) { next.First = String(fields.First || '').trim(); touched = true; }
  if ('Last' in fields)  { next.Last  = String(fields.Last  || '').trim(); touched = true; }
  if (!touched) throw new Error('No editable fields supplied (use the Classes screen to change enrollment)');
  upsertStudent_(next);
  return { ok: true, row: Object.assign({}, next, { classes: getStudentClasses_(email) }) };
}

/** Set the ID on a student that doesn't have one yet. Throws if already set. */
function adminSetStudentId(email, id) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!email) throw new Error('email required');
  if (!id)    throw new Error('id required');
  const trimmedId = String(id).trim();
  const student = getStudentIdentity_(email);
  if (!student) throw new Error('Student not found: ' + email);
  if (String(student.ID || '').trim()) throw new Error('ID already set for ' + email);
  if (rosterData_().students.some((s) => String(s.ID || '').trim() === trimmedId)) {
    throw new Error('ID already in roster: ' + trimmedId);
  }
  upsertStudent_(Object.assign({}, student, { ID: trimmedId }));
  return { ok: true, row: Object.assign({}, student, { ID: trimmedId }) };
}

/** Change an already-set ID. Typed-confirm gated client-side. Validates uniqueness. */
function adminChangeStudentId(email, newId) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!email) throw new Error('email required');
  if (!newId) throw new Error('newId required');
  const trimmedId = String(newId).trim();
  const student = getStudentIdentity_(email);
  if (!student) throw new Error('Student not found: ' + email);
  if (!String(student.ID || '').trim()) throw new Error('No ID set — use adminSetStudentId to add one');
  const targetL = String(email).toLowerCase();
  if (rosterData_().students.some((s) =>
        String(s.Email || '').toLowerCase() !== targetL && String(s.ID || '').trim() === trimmedId)) {
    throw new Error('ID already in roster: ' + trimmedId);
  }
  upsertStudent_(Object.assign({}, student, { ID: trimmedId }));
  return { ok: true, row: Object.assign({}, student, { ID: trimmedId }) };
}

/**
 * Delete a student entirely (identity + all enrollments). Per-student Sheets are
 * PRESERVED — data persists even after roster removal (build-plan §Lifecycle).
 * Returns the list of project Sheets that survive.
 */
function adminDeleteRosterRow(email) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!email) throw new Error('email required');
  const target = String(email).toLowerCase();
  if (!getStudentIdentity_(target)) throw new Error('Student not found: ' + target);
  const preserved = findStudentSheetsForEmail_(target);
  deleteStudent_(target);
  return { ok: true, email: target, preservedSheets: preserved };
}

// ============================================================
// Shared helpers (private to this file)
// ============================================================

/**
 * Build a canonical roster row object. Lowercases emails, trims strings.
 * `requireEmail` makes Email mandatory (true on Add; false reserved for
 * bulk-import preview where rows with blank emails surface as errors,
 * not exceptions).
 */
function canonicalizeRosterRow_(row, requireEmail) {
  const out = {
    ID:           String(row.ID || '').trim(),
    First:        String(row.First || '').trim(),
    Last:         String(row.Last || '').trim(),
    Email:        String(row.Email || '').trim().toLowerCase(),
    Class:        String(row.Class || '').trim(),
    Teacher:      String(row.Teacher || '').trim(),
    TeacherEmail: String(row.TeacherEmail || '').trim().toLowerCase(),
  };
  if (requireEmail && !out.Email) throw new Error('Email required');
  return out;
}

function validateRosterRowOrThrow_(row) {
  if (!row.First) throw new Error('First required');
  if (!row.Last)  throw new Error('Last required');
  if (!row.Email) throw new Error('Email required');
  if (!row.Class) throw new Error('Class required');
  if (!row.TeacherEmail) throw new Error('TeacherEmail required');
}

/**
 * Case-insensitive variant of findRowByKey_ — needed because emails get
 * stored in the canonical lower-case form but the user might pass them
 * mixed-case in URL hashes or arguments.
 */
function findRowByKeyCi_(tab, headers, key, value) {
  const keyCol = headers.indexOf(key);
  if (keyCol < 0) throw new Error('Header missing: ' + key);
  const range = tab.getDataRange().getValues();
  const target = String(value).toLowerCase();
  for (let i = 1; i < range.length; i++) {
    if (String(range[i][keyCol]).toLowerCase() === target) return i + 1;
  }
  return -1;
}

/**
 * For the given studentEmail, find every per-student Sheet that exists
 * across all project folders (active + archived). Returns [{projectId,
 * sheetId}] for the response.
 */
function findStudentSheetsForEmail_(emailLower) {
  const root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);
  const projects = listProjects_();
  const projectFolderById = {};
  projects.forEach((p) => { projectFolderById[p.rootFolderId] = p.projectId; });

  const out = [];
  Object.keys(projectFolderById).forEach((folderId) => {
    let pf;
    try { pf = DriveApp.getFolderById(folderId); }
    catch (e) { return; }  // folder may have been deleted manually; skip
    const classFolders = pf.getFolders();
    while (classFolders.hasNext()) {
      const cf = classFolders.next();
      const files = cf.getFiles();
      while (files.hasNext()) {
        const f = files.next();
        if (!f.isTrashed() && soloSheetNameMatches_(f.getName(), emailLower)) {
          out.push({ projectId: projectFolderById[folderId], sheetId: f.getId() });
        }
      }
    }
  });
  return out;
}

// ============================================================
// Email change (atomic across Roster + Sheets + Drive + Prefs)
// ============================================================

/**
 * Change a student's email. Updates the Roster row, renames every
 * per-student Sheet file (active and archived projects), rewrites every
 * createdByEmail cell in Sources + Highlights of each, updates Meta's
 * studentEmail, and rekeys ScriptProperties entries from
 * `prefs:<oldEmail>:*` to `prefs:<newEmail>:*`.
 *
 * Returns { ok, oldEmail, newEmail, renamedSheets, rewrittenCells, rekeyedPrefs, errors }.
 *
 * Errors are collected per-step rather than thrown — once the Roster row
 * is updated (cheap, atomic), the rename is "official" and downstream
 * cells / files just need to catch up.
 */
function adminChangeStudentEmail(oldEmail, newEmail) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!oldEmail) throw new Error('oldEmail required');
  if (!newEmail) throw new Error('newEmail required');
  const oldL = String(oldEmail).toLowerCase().trim();
  const newL = String(newEmail).toLowerCase().trim();
  if (oldL === newL) throw new Error('Old and new emails are the same');
  if (newL.indexOf('@') < 1 || newL.indexOf('.') < 0) {
    throw new Error('newEmail does not look like an email');
  }

  ensureClassSchema_();
  if (!getStudentIdentity_(oldL)) throw new Error('Student not found: ' + oldL);
  if (getStudentIdentity_(newL)) throw new Error('newEmail already in roster: ' + newL);

  // ----- Step 1: rekey the student across Students + Enrollments -----
  const rss = rosterWorkbook_();
  const studentsTab = getTab_(rss, TABS.STUDENTS);
  const sIdx = findRowByKeyCi_(studentsTab, HEADERS.STUDENTS, 'Email', oldL);
  if (sIdx > 0) studentsTab.getRange(sIdx, HEADERS.STUDENTS.indexOf('Email') + 1).setValue(newL);
  const enrollTab = getTab_(rss, TABS.ENROLLMENTS);
  const enrollEmailCol = HEADERS.ENROLLMENTS.indexOf('Email') + 1;
  if (enrollTab.getLastRow() >= 2) {
    const vals = enrollTab.getRange(2, enrollEmailCol, enrollTab.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < vals.length; i++) {
      if (String(vals[i][0]).toLowerCase() === oldL) enrollTab.getRange(i + 2, enrollEmailCol).setValue(newL);
    }
  }
  invalidateRosterMemo_();

  const errors = [];
  let renamedSheets = 0;
  let rewrittenCells = 0;
  let rekeyedPrefs = 0;

  // ----- Step 2: Rename per-student Sheets + rewrite cells -----
  const projNameById = {};
  listProjects_().forEach((p) => { projNameById[p.projectId] = p.name; });
  const sheets = findStudentSheetsForEmail_(oldL);
  sheets.forEach((s) => {
    try {
      const file = DriveApp.getFileById(s.sheetId);
      file.setName(soloSheetName_(projNameById[s.projectId] || '', newL));
      renamedSheets++;
      const inner = SpreadsheetApp.openById(s.sheetId);
      rewrittenCells += rewriteEmailInTab_(inner, TABS.META,       ['studentEmail'],       oldL, newL);
      rewrittenCells += rewriteEmailInTab_(inner, TABS.SOURCES,    ['createdByEmail'],     oldL, newL);
      rewrittenCells += rewriteEmailInTab_(inner, TABS.HIGHLIGHTS, ['createdByEmail'],     oldL, newL);
    } catch (e) {
      errors.push({ step: 'sheet:' + s.projectId, error: String(e && e.message || e) });
    }
  });

  // ----- Step 3: Rekey ScriptProperties prefs -----
  try {
    const props = PropertiesService.getScriptProperties();
    const all = props.getProperties();
    const oldPrefix = 'prefs:' + oldL + ':';
    const newPrefix = 'prefs:' + newL + ':';
    Object.keys(all).forEach((key) => {
      if (key.indexOf(oldPrefix) === 0) {
        const suffix = key.substring(oldPrefix.length);
        props.setProperty(newPrefix + suffix, all[key]);
        props.deleteProperty(key);
        rekeyedPrefs++;
      }
    });
  } catch (e) {
    errors.push({ step: 'prefs', error: String(e && e.message || e) });
  }

  return {
    ok: true,
    oldEmail: oldL,
    newEmail: newL,
    renamedSheets,
    rewrittenCells,
    rekeyedPrefs,
    errors,
  };
}

/**
 * Walk a tab, find cells in `cols` matching `oldEmail` (case-insensitive),
 * rewrite them to `newEmail`. Returns the count rewritten.
 */
function rewriteEmailInTab_(ss, tabName, cols, oldEmail, newEmail) {
  const tab = ss.getSheetByName(tabName);
  if (!tab) return 0;
  const data = tab.getDataRange().getValues();
  if (data.length < 2) return 0;
  const header = data[0].map((h) => String(h));
  const colIdx = cols
    .map((c) => header.indexOf(c))
    .filter((i) => i >= 0);
  if (colIdx.length === 0) return 0;
  let changed = 0;
  for (let r = 1; r < data.length; r++) {
    colIdx.forEach((c) => {
      if (String(data[r][c]).toLowerCase() === oldEmail) {
        tab.getRange(r + 1, c + 1).setValue(newEmail);
        changed++;
      }
    });
  }
  return changed;
}

// ============================================================
// Bulk roster replace
// ============================================================

/**
 * Pure diff/validation pass. Never mutates. Used by the import dialog
 * to show the admin what will change before they commit.
 *
 * `rows` is an array of roster row objects (any shape; canonicalized here).
 *
 * Returns:
 *   {
 *     ok: true,
 *     added: N,            // emails in `rows` not in current
 *     removed: N,          // emails in current not in `rows`
 *     changed: N,          // emails in both but with at least one different field
 *     unchanged: N,
 *     errors: [{rowIndex, error}],
 *   }
 *
 * If errors.length > 0, the client must NOT call adminReplaceRoster.
 */
function adminPreviewReplaceRoster(rows) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  const result = analyzeRosterReplace_(rows);
  return Object.assign({ ok: true }, result);
}

/**
 * Atomic swap: validates, computes diff, clears existing roster rows,
 * appends the new ones. Per-student Sheets are NEVER touched.
 *
 * If validation errors exist, throws — caller must have run preview first.
 */
function adminReplaceRoster(rows) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  const analysis = analyzeRosterReplace_(rows);
  if (analysis.errors.length > 0) {
    throw new Error('Validation errors — run adminPreviewReplaceRoster first');
  }
  // Rebuild the normalized trio (Students/Classes/Enrollments) from the flat
  // import via the model. Per-student Sheets are never touched.
  replaceRoster_(analysis.canonical);
  return {
    ok: true,
    added: analysis.added,
    removed: analysis.removed,
    changed: analysis.changed,
    unchanged: analysis.unchanged,
  };
}

/** Current roster flattened to one {ID,First,Last,Email,Class,TeacherEmail} row
 *  per enrollment — the comparison baseline for an import diff. */
function currentFlatRoster_() {
  ensureClassSchema_();
  const data = rosterData_();
  const studentByEmail = {};
  data.students.forEach((s) => { studentByEmail[String(s.Email).toLowerCase()] = s; });
  const classTeacherOf = {};
  listClasses_().forEach((c) => { classTeacherOf[c.Class] = c.TeacherEmail; });
  return data.enrollments.map((e) => {
    const em = String(e.Email).toLowerCase();
    const s = studentByEmail[em] || { ID: '', First: '', Last: '' };
    const cls = String(e.Class).trim();
    return canonicalizeRosterRow_({
      ID: s.ID, First: s.First, Last: s.Last, Email: em, Class: cls, TeacherEmail: classTeacherOf[cls] || '',
    }, /*requireEmail=*/false);
  });
}

/**
 * Shared logic for preview + commit. Canonicalizes, validates, diffs
 * against the current roster. Pure.
 */
function analyzeRosterReplace_(rows) {
  const errors = [];
  const canonical = [];
  const seenEmail = {};
  const seenId = {};

  rows.forEach((r, i) => {
    const idx = i + 1;
    let c;
    try { c = canonicalizeRosterRow_(r, /*requireEmail=*/false); }
    catch (e) { errors.push({ rowIndex: idx, error: String(e.message || e) }); return; }

    if (!c.Email) errors.push({ rowIndex: idx, error: 'blank Email' });
    if (!c.First) errors.push({ rowIndex: idx, error: 'blank First' });
    if (!c.Last)  errors.push({ rowIndex: idx, error: 'blank Last' });
    if (!c.Class) errors.push({ rowIndex: idx, error: 'blank Class' });
    if (!c.TeacherEmail) errors.push({ rowIndex: idx, error: 'blank TeacherEmail' });

    if (c.Email) {
      if (seenEmail[c.Email]) errors.push({ rowIndex: idx, error: 'duplicate Email ' + c.Email });
      seenEmail[c.Email] = true;
    }
    if (c.ID) {
      if (seenId[c.ID]) errors.push({ rowIndex: idx, error: 'duplicate ID ' + c.ID });
      seenId[c.ID] = true;
    }
    canonical.push(c);
  });

  // Diff vs. the current roster at ENROLLMENT granularity (email|class), since a
  // student can now appear in several classes. added/removed/changed are over
  // (student,class) rows; an identity edit on an existing enrollment is "changed".
  const current = currentFlatRoster_();
  const keyOf = (r) => r.Email + '|' + r.Class;
  const currentByKey = {};
  current.forEach((r) => { if (r.Email) currentByKey[keyOf(r)] = r; });
  const newByKey = {};
  canonical.forEach((r) => { if (r.Email) newByKey[keyOf(r)] = r; });

  let added = 0, removed = 0, changed = 0, unchanged = 0;
  Object.keys(newByKey).forEach((k) => {
    if (!currentByKey[k]) { added++; return; }
    const before = currentByKey[k];
    const after = newByKey[k];
    const differ = ['ID', 'First', 'Last', 'TeacherEmail'].some((h) => String(before[h] || '') !== String(after[h] || ''));
    if (differ) changed++; else unchanged++;
  });
  Object.keys(currentByKey).forEach((k) => {
    if (!newByKey[k]) removed++;
  });

  return { added, removed, changed, unchanged, errors, canonical };
}

// ============================================================
// Staff CRUD + last-admin guard
// ============================================================

/**
 * Throws 'Cannot remove the only admin — promote another staff member
 * first' if changing `targetEmail` to `newRole` would leave the Staff
 * sheet with zero admins.
 *
 * Called by adminUpdateStaffRow (when Role changes), adminChangeStaffEmail
 * (the email change itself doesn't change Role, but the row identity is
 * being touched — passes the current Role through), and adminDeleteStaffRow
 * (newRole='__delete__' sentinel — any non-admin value works).
 */
function ensureNotLastAdminRemoval_(targetEmail, newRole) {
  if (newRole === ROLES.ADMIN) return;
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const all = readAllAsObjects_(getTab_(ss, TABS.STAFF), HEADERS.STAFF);
  const admins = all.filter((r) => r.Role === ROLES.ADMIN);
  const targetLower = String(targetEmail).toLowerCase();
  if (admins.length === 1 && String(admins[0].Email).toLowerCase() === targetLower) {
    throw new Error('Cannot remove the only admin — promote another staff member first');
  }
}

function adminGetStaff() {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const rows = readAllAsObjects_(getTab_(ss, TABS.STAFF), HEADERS.STAFF);
  return {
    ok: true,
    rows: rows.map((r) => ({
      Name:  String(r.Name || ''),
      Email: String(r.Email || '').toLowerCase(),
      Role:  String(r.Role || ''),
    })),
  };
}

function adminAddStaffRow(row) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!row) throw new Error('row required');
  const name = String(row.Name || '').trim();
  const email = String(row.Email || '').trim().toLowerCase();
  const role = String(row.Role || '').trim().toLowerCase();
  if (!name)  throw new Error('Name required');
  if (!email) throw new Error('Email required');
  if (role !== ROLES.TEACHER && role !== ROLES.ADMIN) throw new Error('Role must be teacher or admin');
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.STAFF);
  const all = readAllAsObjects_(tab, HEADERS.STAFF);
  if (all.some((r) => String(r.Email || '').toLowerCase() === email)) {
    throw new Error('Email already in staff: ' + email);
  }
  const stored = { Name: name, Email: email, Role: role };
  appendRow_(tab, HEADERS.STAFF, stored);
  return { ok: true, row: stored };
}

function adminUpdateStaffRow(email, fields) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!email) throw new Error('email required');
  if (!fields) throw new Error('fields required');
  const target = String(email).toLowerCase();
  const updates = {};
  if ('Name' in fields) updates.Name = String(fields.Name || '');
  if ('Role' in fields) {
    const nr = String(fields.Role || '').toLowerCase();
    if (nr !== ROLES.TEACHER && nr !== ROLES.ADMIN) throw new Error('Role must be teacher or admin');
    updates.Role = nr;
    ensureNotLastAdminRemoval_(target, nr);
  }
  if (Object.keys(updates).length === 0) throw new Error('No editable fields supplied');

  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.STAFF);
  const rowIdx = findRowByKeyCi_(tab, HEADERS.STAFF, 'Email', target);
  if (rowIdx < 0) throw new Error('Staff row not found: ' + target);
  HEADERS.STAFF.forEach((header, i) => {
    if (header in updates) tab.getRange(rowIdx, i + 1).setValue(updates[header]);
  });
  const all = readAllAsObjects_(tab, HEADERS.STAFF);
  const updated = all.find((r) => String(r.Email || '').toLowerCase() === target);
  return { ok: true, row: updated };
}

function adminChangeStaffEmail(oldEmail, newEmail) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!oldEmail) throw new Error('oldEmail required');
  if (!newEmail) throw new Error('newEmail required');
  const oldL = String(oldEmail).toLowerCase().trim();
  const newL = String(newEmail).toLowerCase().trim();
  if (oldL === newL) throw new Error('Old and new emails are the same');

  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.STAFF);
  const all = readAllAsObjects_(tab, HEADERS.STAFF);
  const target = all.find((r) => String(r.Email || '').toLowerCase() === oldL);
  if (!target) throw new Error('Staff row not found: ' + oldL);
  if (all.some((r) => String(r.Email || '').toLowerCase() === newL)) {
    throw new Error('newEmail already in staff: ' + newL);
  }
  const rowIdx = findRowByKeyCi_(tab, HEADERS.STAFF, 'Email', oldL);
  const emailCol = HEADERS.STAFF.indexOf('Email') + 1;
  tab.getRange(rowIdx, emailCol).setValue(newL);
  return { ok: true, oldEmail: oldL, newEmail: newL };
}

function adminDeleteStaffRow(email) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!email) throw new Error('email required');
  const target = String(email).toLowerCase();
  // Treat deletion as "set role to <nothing>" for the guard.
  ensureNotLastAdminRemoval_(target, '__deleted__');
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.STAFF);
  const rowIdx = findRowByKeyCi_(tab, HEADERS.STAFF, 'Email', target);
  if (rowIdx < 0) throw new Error('Staff row not found: ' + target);
  tab.deleteRow(rowIdx);
  return { ok: true, email: target };
}

// ============================================================
// Archive school year
// ============================================================

/**
 * Distinct schoolYear strings from currently-active projects, sorted
 * descending (so newest year floats to the top of the dropdown).
 */
function adminListArchivableYears() {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  const set = {};
  listProjects_().forEach((p) => {
    if (p.status === PROJECT_STATUS.ACTIVE && p.schoolYear) set[p.schoolYear] = true;
  });
  return { ok: true, years: Object.keys(set).sort().reverse() };
}

/**
 * The active projects in the given year + a summary row count, so the
 * UI can show "this will affect N projects" before commit.
 */
function adminPreviewArchiveYear(schoolYear) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!schoolYear) throw new Error('schoolYear required');

  const projects = listProjects_().filter(
    (p) => p.schoolYear === schoolYear && p.status === PROJECT_STATUS.ACTIVE
  );

  // Roster-side student counts (no per-Sheet opens) — distinct enrolled students.
  const out = projects.map((p) => {
    const classes = projectClassList_(p);
    return {
      projectId: p.projectId,
      name: p.name,
      memberClasses: classes,
      studentCount: studentsInClasses_(classes).length,
    };
  });
  return { ok: true, schoolYear, projects: out };
}

// ============================================================
// Classes management (Classes v2)
// ============================================================

/**
 * All classes with teacher (email + display name from Staff), school year,
 * status, and enrolled-student count. Drives the admin "Classes" screen and the
 * New Project wizard's class picker.
 */
function adminListClasses() {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  ensureClassSchema_();
  const staffByEmail = {};
  readAllAsObjects_(getTab_(rosterWorkbook_(), TABS.STAFF), HEADERS.STAFF)
    .forEach((s) => { staffByEmail[String(s.Email).toLowerCase()] = String(s.Name || ''); });
  const countByClass = {};
  rosterData_().enrollments.forEach((e) => {
    const c = String(e.Class).trim();
    countByClass[c] = (countByClass[c] || 0) + 1;
  });
  return {
    ok: true,
    classes: listClasses_().map((c) => ({
      Class: c.Class,
      Name: c.Name,
      Period: c.Period,
      label: classDisplayLabel_(c),
      TeacherEmail: c.TeacherEmail,
      teacherName: staffByEmail[c.TeacherEmail] || '',
      SchoolYear: c.SchoolYear,
      Status: c.Status,
      studentCount: countByClass[c.Class] || 0,
    })),
  };
}

/**
 * Create a class from display fields {name, period?, teacherEmail?, schoolYear?}.
 * The stored Class key is system-composed (name + period + teacher last name) —
 * the admin never types a teacher into the class name.
 */
function adminCreateClass(args) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!args || !String(args.name || '').trim()) throw new Error('Class name required');
  const teacherEmail = String(args.teacherEmail || '').trim().toLowerCase();
  if (teacherEmail && !getStaffEntry_(teacherEmail)) throw new Error('Teacher is not on Staff: ' + teacherEmail);
  return {
    ok: true,
    class: createClassV2_({
      name: args.name, period: args.period || '',
      teacherEmail, schoolYear: args.schoolYear || '',
    }),
  };
}

/** Update a class's teacher / school year / status / display Name / Period. */
function adminUpdateClass(name, fields) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!name) throw new Error('class name required');
  if (!fields) throw new Error('fields required');
  if ('TeacherEmail' in fields) {
    const te = String(fields.TeacherEmail || '').trim().toLowerCase();
    if (te && !getStaffEntry_(te)) throw new Error('Teacher is not on Staff: ' + te);
  }
  return { ok: true, class: updateClass_(name, fields) };
}

/**
 * Bulk-add staff from a pasted list. rows: [{Email, First, Last}]. All created
 * as role=teacher (admins are promoted one-at-a-time in the Staff screen).
 * Existing emails are skipped, not errors. Returns
 *   { ok, added, skipped, errors:[{rowIndex,error}] }.
 */
function adminBulkAddStaff(rows) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.STAFF);
  const have = new Set(readAllAsObjects_(tab, HEADERS.STAFF)
    .map((r) => String(r.Email || '').toLowerCase()).filter(Boolean));
  const errors = [];
  const toAdd = [];
  rows.forEach((r, i) => {
    const email = String((r && r.Email) || '').trim().toLowerCase();
    const first = String((r && r.First) || '').trim();
    const last = String((r && r.Last) || '').trim();
    if (!email || email.indexOf('@') < 1 || email.indexOf('.') < 0) {
      errors.push({ rowIndex: i + 1, error: 'missing/invalid email' });
      return;
    }
    if (have.has(email)) return;   // counted as skipped below
    const name = [first, last].filter(Boolean).join(' ').trim();
    if (!name) { errors.push({ rowIndex: i + 1, error: 'name required: ' + email }); return; }
    have.add(email);
    toAdd.push({ Name: name, Email: email, Role: ROLES.TEACHER });
  });
  if (toAdd.length) {
    const values = toAdd.map((rec) => HEADERS.STAFF.map((h) => rec[h]));
    tab.getRange(tab.getLastRow() + 1, 1, values.length, HEADERS.STAFF.length).setValues(values);
  }
  const skipped = rows.length - toAdd.length - errors.length;
  return { ok: true, added: toAdd.length, skipped, errors };
}

/**
 * Bulk-create classes from the sections form's teachers × periods combos.
 * combos: [{name, period, teacherEmail, schoolYear}]. Each combo is created
 * independently; a duplicate (Name, Period, Teacher) is reported, not fatal.
 * Returns { ok, created:[label…], skipped:[{label, error}] }.
 */
function adminBulkCreateClasses(combos) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!Array.isArray(combos) || combos.length === 0) throw new Error('combos required');
  const created = [];
  const skipped = [];
  combos.forEach((c) => {
    const label = [String((c && c.name) || '').trim(), String((c && c.period) || '').trim()]
      .filter(Boolean).join(' · ');
    try {
      const teacherEmail = String((c && c.teacherEmail) || '').trim().toLowerCase();
      if (!teacherEmail || !getStaffEntry_(teacherEmail)) {
        throw new Error('Teacher is not on Staff: ' + (teacherEmail || '(blank)'));
      }
      const rec = createClassV2_({
        name: c.name, period: c.period || '',
        teacherEmail, schoolYear: c.schoolYear || '',
      });
      created.push(rec.Class);
    } catch (e) {
      skipped.push({ label, error: String(e && e.message || e) });
    }
  });
  return { ok: true, created, skipped };
}

/** Delete a class + its enrollments. Per-student Sheets are preserved. */
function adminDeleteClass(name) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!name) throw new Error('class name required');
  return deleteClass_(name);
}

/** Enrolled students (identity) for one class. */
function adminGetClassRoster(name) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!name) throw new Error('class name required');
  ensureClassSchema_();
  const students = excludeSampleIfDisabled_(studentsInClasses_([name]));
  return {
    ok: true,
    class: name,
    students: students.map((s) => ({ ID: s.ID, First: s.First, Last: s.Last, Email: s.Email })),
  };
}

/** Enroll an existing student in a class. */
function adminEnrollStudent(email, className) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!email || !className) throw new Error('email and class required');
  if (!getStudentIdentity_(email)) throw new Error('Student not found: ' + email);
  if (!getClassRecord_(className)) throw new Error('No such class: ' + className);
  return enroll_(email, className);
}

/** Remove a student from a class (their per-project Sheets are preserved). */
function adminUnenrollStudent(email, className) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!email || !className) throw new Error('email and class required');
  return unenroll_(email, className);
}

/** Set a student's full set of classes (diff add/remove). */
function adminSetStudentClasses(email, classNames) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!email) throw new Error('email required');
  if (!getStudentIdentity_(email)) throw new Error('Student not found: ' + email);
  const names = Array.isArray(classNames) ? classNames : [];
  names.forEach((c) => { if (!getClassRecord_(c)) throw new Error('No such class: ' + c); });
  return setStudentClasses_(email, names);
}

/**
 * Bulk-enroll students into a class from a pasted list. Each row is
 * {ID?, First?, Last?, Email}. A row with First+Last creates (or updates) the
 * student identity; an email-only row enrolls an existing student and errors if
 * that email is unknown (we can't create a student without a name). Enrollments
 * are written in one batch. Returns
 *   { ok, class, enrolled, created, alreadyEnrolled, errors:[{rowIndex,error}] }.
 */
function adminBulkEnroll(className, rows) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  const cls = String(className || '').trim();
  if (!cls) throw new Error('class name required');
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  ensureClassSchema_();
  if (!getClassRecord_(cls)) throw new Error('No such class: ' + cls);

  const alreadyBefore = new Set(enrollmentsForClass_(cls).map((e) => e.toLowerCase()));
  const errors = [];
  const toEnroll = [];
  let created = 0;
  rows.forEach((r, i) => {
    try {
      const email = String((r && r.Email) || '').trim().toLowerCase();
      if (!email || email.indexOf('@') < 1 || email.indexOf('.') < 0) {
        errors.push({ rowIndex: i + 1, error: 'missing/invalid email' });
        return;
      }
      const first = String((r && r.First) || '').trim();
      const last = String((r && r.Last) || '').trim();
      const id = String((r && r.ID) || '').trim();
      const existing = getStudentIdentity_(email);
      if (!existing) {
        if (!first || !last) { errors.push({ rowIndex: i + 1, error: 'new student needs First + Last: ' + email }); return; }
        upsertStudent_({ ID: id, First: first, Last: last, Email: email });
        created++;
      } else if (first || last || id) {
        upsertStudent_({ ID: id || existing.ID, First: first || existing.First, Last: last || existing.Last, Email: email });
      }
      toEnroll.push(email);
    } catch (e) {
      errors.push({ rowIndex: i + 1, error: String(e && e.message || e) });
    }
  });
  const enrolled = enrollMany_(toEnroll, cls);
  const alreadyEnrolled = toEnroll.filter((e) => alreadyBefore.has(e)).length;
  return { ok: true, class: cls, enrolled, created, alreadyEnrolled, errors };
}

/**
 * Bulk archive every active project in the given year. Confirm phrase
 * must equal `ARCHIVE <schoolYear>` exactly (server re-checks client
 * gating).
 *
 * Calls the shared archiveSchoolYear_ helper in 65_lifecycle.js.
 */
function adminArchiveSchoolYear(schoolYear, confirmPhrase) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!schoolYear) throw new Error('schoolYear required');
  const expected = 'ARCHIVE ' + schoolYear;
  if (String(confirmPhrase || '') !== expected) {
    throw new Error('Confirm phrase mismatch — expected "' + expected + '"');
  }
  return archiveSchoolYear_(schoolYear, actorEmail);
}
