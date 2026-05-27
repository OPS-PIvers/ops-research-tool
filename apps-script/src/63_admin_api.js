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
 * hasWork[email] = true iff there exists a Sheet file named `<email>`
 * inside any class folder under any project root (active OR archived).
 *
 * Implementation: one Drive walk per call. For ~10 projects × ~5
 * classes × ~25 students that's ~1500 Drive items — handled in a few
 * seconds. The result is used to decide whether to require a
 * typed-confirm modal for row delete (Section 7.2 of spec).
 */
function adminGetRoster() {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const rows = readAllAsObjects_(getTab_(ss, TABS.ROSTER), HEADERS.ROSTER);
  const workEmails = listAllStudentSheetEmails_();
  return {
    ok: true,
    rows: rows.map((r) => ({
      ID: String(r.ID || ''),
      First: String(r.First || ''),
      Last: String(r.Last || ''),
      Email: String(r.Email || '').toLowerCase(),
      Class: String(r.Class || ''),
      Teacher: String(r.Teacher || ''),
      TeacherEmail: String(r.TeacherEmail || '').toLowerCase(),
      hasWork: workEmails[String(r.Email || '').toLowerCase()] === true,
    })),
  };
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
        const name = fl.getName().toLowerCase();
        // Per-student Sheets are named exactly `[email]`. Cheap filter:
        // anything with an @ and a dot is plausibly an email.
        if (name.indexOf('@') > 0 && name.indexOf('.') > 0) {
          out[name] = true;
        }
      }
    }
  });

  return out;
}

// ============================================================
// Roster mutations
// ============================================================

/**
 * Add a new roster row. Validates required fields, email uniqueness
 * (case-insensitive), and ID uniqueness (if provided).
 *
 * `row` shape (input): {ID?, First, Last, Email, Class, Teacher?, TeacherEmail?}
 * Returns { ok, row } with the canonicalized stored values.
 */
function adminAddRosterRow(row) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!row) throw new Error('row required');
  const out = canonicalizeRosterRow_(row, /*requireEmail=*/true);
  validateRosterRowOrThrow_(out);
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.ROSTER);
  const all = readAllAsObjects_(tab, HEADERS.ROSTER);
  if (all.some((r) => String(r.Email || '').toLowerCase() === out.Email)) {
    throw new Error('Email already in roster: ' + out.Email);
  }
  if (out.ID && all.some((r) => String(r.ID || '').trim() === out.ID)) {
    throw new Error('ID already in roster: ' + out.ID);
  }
  appendRow_(tab, HEADERS.ROSTER, out);
  return { ok: true, row: out };
}

/**
 * Update an existing roster row, identified by Email. Accepts any subset
 * of {First, Last, Class, Teacher, TeacherEmail}. Email and ID are
 * deliberately NOT accepted here — they go through dedicated endpoints.
 */
function adminUpdateRosterRow(email, fields) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!email) throw new Error('email required');
  if (!fields) throw new Error('fields required');
  const target = String(email).toLowerCase();
  const allowed = ['First', 'Last', 'Class', 'Teacher', 'TeacherEmail'];
  const updates = {};
  Object.keys(fields).forEach((k) => {
    if (allowed.indexOf(k) >= 0) updates[k] = String(fields[k] || '');
  });
  if (Object.keys(updates).length === 0) throw new Error('No editable fields supplied');
  if ('TeacherEmail' in updates) updates.TeacherEmail = updates.TeacherEmail.toLowerCase();

  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.ROSTER);
  const rowIdx = findRowByKeyCi_(tab, HEADERS.ROSTER, 'Email', target);
  if (rowIdx < 0) throw new Error('Roster row not found: ' + target);
  HEADERS.ROSTER.forEach((header, i) => {
    if (header in updates) tab.getRange(rowIdx, i + 1).setValue(updates[header]);
  });
  const updatedObjects = readAllAsObjects_(tab, HEADERS.ROSTER);
  const updated = updatedObjects.find((r) => String(r.Email || '').toLowerCase() === target);
  return { ok: true, row: updated };
}

/**
 * Set the ID on a roster row that doesn't have one yet. Throws if already set.
 */
function adminSetStudentId(email, id) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!email) throw new Error('email required');
  if (!id)    throw new Error('id required');
  const target = String(email).toLowerCase();
  const trimmedId = String(id).trim();
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.ROSTER);
  const all = readAllAsObjects_(tab, HEADERS.ROSTER);
  const target_row = all.find((r) => String(r.Email || '').toLowerCase() === target);
  if (!target_row) throw new Error('Roster row not found: ' + target);
  if (String(target_row.ID || '').trim()) throw new Error('ID already set for ' + target);
  if (all.some((r) => String(r.ID || '').trim() === trimmedId)) {
    throw new Error('ID already in roster: ' + trimmedId);
  }
  const rowIdx = findRowByKeyCi_(tab, HEADERS.ROSTER, 'Email', target);
  const idCol = HEADERS.ROSTER.indexOf('ID') + 1;
  tab.getRange(rowIdx, idCol).setValue(trimmedId);
  return { ok: true, row: Object.assign({}, target_row, { ID: trimmedId }) };
}

/**
 * Change an already-set ID. Typed-confirm gated client-side. Server
 * validates uniqueness.
 */
function adminChangeStudentId(email, newId) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!email) throw new Error('email required');
  if (!newId) throw new Error('newId required');
  const target = String(email).toLowerCase();
  const trimmedId = String(newId).trim();
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.ROSTER);
  const all = readAllAsObjects_(tab, HEADERS.ROSTER);
  const target_row = all.find((r) => String(r.Email || '').toLowerCase() === target);
  if (!target_row) throw new Error('Roster row not found: ' + target);
  if (!String(target_row.ID || '').trim()) {
    throw new Error('No ID set — use adminSetStudentId to add one');
  }
  if (all.some((r) =>
        String(r.Email || '').toLowerCase() !== target &&
        String(r.ID || '').trim() === trimmedId)) {
    throw new Error('ID already in roster: ' + trimmedId);
  }
  const rowIdx = findRowByKeyCi_(tab, HEADERS.ROSTER, 'Email', target);
  const idCol = HEADERS.ROSTER.indexOf('ID') + 1;
  tab.getRange(rowIdx, idCol).setValue(trimmedId);
  return { ok: true, row: Object.assign({}, target_row, { ID: trimmedId }) };
}

/**
 * Delete a roster row. Per-student Sheets are PRESERVED — data persists
 * even after roster removal (per build-plan §Lifecycle). Returns the
 * list of project Sheets that survive.
 */
function adminDeleteRosterRow(email) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!email) throw new Error('email required');
  const target = String(email).toLowerCase();
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.ROSTER);
  const rowIdx = findRowByKeyCi_(tab, HEADERS.ROSTER, 'Email', target);
  if (rowIdx < 0) throw new Error('Roster row not found: ' + target);

  // Identify preserved per-student Sheets so the response can surface them.
  const preserved = findStudentSheetsForEmail_(target);

  // Delete the row (Sheets API uses 1-based row indices).
  tab.deleteRow(rowIdx);
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
      const files = cf.getFilesByName(emailLower);
      while (files.hasNext()) {
        out.push({ projectId: projectFolderById[folderId], sheetId: files.next().getId() });
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

  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.ROSTER);
  const rosterRows = readAllAsObjects_(tab, HEADERS.ROSTER);
  if (!rosterRows.find((r) => String(r.Email || '').toLowerCase() === oldL)) {
    throw new Error('Roster row not found: ' + oldL);
  }
  if (rosterRows.find((r) => String(r.Email || '').toLowerCase() === newL)) {
    throw new Error('newEmail already in roster: ' + newL);
  }

  // ----- Step 1: Roster row email cell -----
  const rowIdx = findRowByKeyCi_(tab, HEADERS.ROSTER, 'Email', oldL);
  const emailCol = HEADERS.ROSTER.indexOf('Email') + 1;
  tab.getRange(rowIdx, emailCol).setValue(newL);

  const errors = [];
  let renamedSheets = 0;
  let rewrittenCells = 0;
  let rekeyedPrefs = 0;

  // ----- Step 2: Rename per-student Sheets + rewrite cells -----
  const sheets = findStudentSheetsForEmail_(oldL);
  sheets.forEach((s) => {
    try {
      const file = DriveApp.getFileById(s.sheetId);
      file.setName(newL);
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

  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.ROSTER);

  // Wipe existing rows (preserve header).
  const lastRow = tab.getLastRow();
  if (lastRow > 1) {
    tab.getRange(2, 1, lastRow - 1, HEADERS.ROSTER.length).clearContent();
    // Delete extra rows so subsequent reads don't see leftover blank rows.
    if (lastRow > 2) tab.deleteRows(2, lastRow - 2);
  }

  // Append the new ones in one batched write (faster than per-row appendRow_).
  const matrix = analysis.canonical.map((r) => HEADERS.ROSTER.map((h) => r[h] || ''));
  if (matrix.length > 0) {
    tab.getRange(2, 1, matrix.length, HEADERS.ROSTER.length).setValues(matrix);
  }
  return {
    ok: true,
    added: analysis.added,
    removed: analysis.removed,
    changed: analysis.changed,
    unchanged: analysis.unchanged,
  };
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

  // Diff vs. current Roster.
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const current = readAllAsObjects_(getTab_(ss, TABS.ROSTER), HEADERS.ROSTER)
    .map((r) => canonicalizeRosterRow_(r, /*requireEmail=*/false));

  const currentByEmail = {};
  current.forEach((r) => { if (r.Email) currentByEmail[r.Email] = r; });
  const newByEmail = {};
  canonical.forEach((r) => { if (r.Email) newByEmail[r.Email] = r; });

  let added = 0, removed = 0, changed = 0, unchanged = 0;
  Object.keys(newByEmail).forEach((e) => {
    if (!currentByEmail[e]) { added++; return; }
    const before = currentByEmail[e];
    const after = newByEmail[e];
    const fieldsDiffer = HEADERS.ROSTER.some((h) => String(before[h] || '') !== String(after[h] || ''));
    if (fieldsDiffer) changed++; else unchanged++;
  });
  Object.keys(currentByEmail).forEach((e) => {
    if (!newByEmail[e]) removed++;
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

  // Roster-side student counts (no per-Sheet opens).
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const rosterRows = readAllAsObjects_(getTab_(ss, TABS.ROSTER), HEADERS.ROSTER);

  const out = projects.map((p) => {
    const classes = projectClassList_(p);
    const count = rosterRows.filter(
      (r) => r.Class && classes.indexOf(String(r.Class).trim()) >= 0
    ).length;
    return {
      projectId: p.projectId,
      name: p.name,
      memberClasses: classes,
      studentCount: count,
    };
  });
  return { ok: true, schoolYear, projects: out };
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
