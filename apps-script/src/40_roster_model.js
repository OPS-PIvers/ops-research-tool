/**
 * Roster data model v2 — normalized Students / Classes / Enrollments.
 *
 * Replaces the flat one-row-per-student `Roster` tab so a STUDENT CAN BE IN
 * MULTIPLE CLASSES. See docs/2026-06-04-classes-redesign-plan.md.
 *
 *   Students    [ID, First, Last, Email]            one row per person
 *   Classes     [Class, TeacherEmail, SchoolYear, Status]   one teacher per class
 *   Enrollments [Email, Class]                       student↔class many-to-many
 *
 * `Class` stays a STRING KEY everywhere (Projects.memberClasses, Drive class
 * folders, groups) — the Classes tab only adds metadata. The legacy `Roster`
 * tab is preserved untouched as backup + the one-time migration source.
 *
 * This file is the single source of truth for roster identity/eligibility:
 * `getStudentRosterEntry_` and `listClassesTaughtBy_` live HERE (removed from
 * 10_identity.js / 61_console_api.js to avoid the same-name shadowing trap —
 * see CLAUDE.md §5).
 */

const SCHEMA_V2_PROP = 'OPS_CLASS_SCHEMA_V2';

// =====================================================================
// PURE transform (Node-tested) — legacy flat rows → normalized trio.
// =====================================================================

/**
 * Build the normalized trio from legacy flat Roster rows.
 * @param {Array<{ID,First,Last,Email,Class,Teacher,TeacherEmail}>} rows
 * @return {{students:Array, classes:Array, enrollments:Array}}
 * - students deduped by lowercased Email (first occurrence wins for identity)
 * - classes deduped by Class name (first non-empty TeacherEmail wins)
 * - enrollments deduped by (email,class)
 */
function buildClassSchemaFromLegacy_(rows) {
  const students = [];
  const studentSeen = new Set();
  const classes = [];
  const classIdx = {};            // className -> index in `classes`
  const enrollments = [];
  const enrollSeen = new Set();

  (rows || []).forEach((r) => {
    const email = String(r.Email || '').trim().toLowerCase();
    const cls = String(r.Class || '').trim();
    const teacher = String(r.TeacherEmail || '').trim().toLowerCase();

    if (email && !studentSeen.has(email)) {
      studentSeen.add(email);
      students.push({
        ID: String(r.ID || '').trim(),
        First: String(r.First || '').trim(),
        Last: String(r.Last || '').trim(),
        Email: email,
      });
    }

    if (cls) {
      if (!(cls in classIdx)) {
        classIdx[cls] = classes.length;
        classes.push({ Class: cls, TeacherEmail: teacher, SchoolYear: '', Status: CLASS_STATUS.ACTIVE });
      } else if (teacher && !classes[classIdx[cls]].TeacherEmail) {
        classes[classIdx[cls]].TeacherEmail = teacher; // backfill a blank teacher from a later row
      }
    }

    if (email && cls) {
      const key = email + '|' + cls;
      if (!enrollSeen.has(key)) {
        enrollSeen.add(key);
        enrollments.push({ Email: email, Class: cls });
      }
    }
  });

  return { students, classes, enrollments };
}

/**
 * PURE: projects whose memberClasses intersect any of the student's classes.
 * @param {string[]} studentClasses
 * @param {Array<{memberClasses:string}>} projects  (already status-filtered)
 */
function studentEligibleProjects_(studentClasses, projects) {
  const mine = new Set((studentClasses || []).map((c) => String(c).trim()).filter(Boolean));
  if (mine.size === 0) return [];
  return (projects || []).filter((p) => {
    const cs = String(p.memberClasses || '').split(',').map((s) => s.trim()).filter(Boolean);
    return cs.some((c) => mine.has(c));
  });
}

// =====================================================================
// Schema ensure + one-time migration (self-healing, guarded, reversible).
// =====================================================================

function rosterWorkbook_() {
  return SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
}

function getOrCreateTab_(ss, name, headers) {
  let tab = ss.getSheetByName(name);
  if (!tab) tab = ss.insertSheet(name);
  ensureHeaders_(tab, headers);
  return tab;
}

/**
 * Ensure the v2 trio exists and, the first time only, backfill it from the
 * legacy `Roster` tab. Idempotent: guarded by the SCHEMA_V2_PROP property AND
 * only seeds tabs that are still empty, so it never clobbers admin edits.
 * Cheap on the hot path (a property read + getSheetByName) after first run.
 */
function ensureClassSchema_() {
  const ss = rosterWorkbook_();
  getOrCreateTab_(ss, TABS.STUDENTS, HEADERS.STUDENTS);
  getOrCreateTab_(ss, TABS.CLASSES, HEADERS.CLASSES);
  getOrCreateTab_(ss, TABS.ENROLLMENTS, HEADERS.ENROLLMENTS);

  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(SCHEMA_V2_PROP) === 'done') return;

  const legacy = ss.getSheetByName(TABS.ROSTER);
  if (legacy && legacy.getLastRow() >= 2) {
    const built = buildClassSchemaFromLegacy_(readAllAsObjects_(legacy, HEADERS.ROSTER));
    const sTab = getTab_(ss, TABS.STUDENTS);
    const cTab = getTab_(ss, TABS.CLASSES);
    const eTab = getTab_(ss, TABS.ENROLLMENTS);
    if (sTab.getLastRow() < 2) built.students.forEach((s) => appendRow_(sTab, HEADERS.STUDENTS, s));
    if (cTab.getLastRow() < 2) built.classes.forEach((c) => appendRow_(cTab, HEADERS.CLASSES, c));
    if (eTab.getLastRow() < 2) built.enrollments.forEach((e) => appendRow_(eTab, HEADERS.ENROLLMENTS, e));
  }
  props.setProperty(SCHEMA_V2_PROP, 'done');
  invalidateRosterMemo_();
}

// =====================================================================
// Memoized reads (one batched read per execution; reset by every write).
// =====================================================================

let _rosterMemo = null;

function rosterData_() {
  if (_rosterMemo) return _rosterMemo;
  ensureClassSchema_();
  const ss = rosterWorkbook_();
  _rosterMemo = {
    students: readAllAsObjects_(getTab_(ss, TABS.STUDENTS), HEADERS.STUDENTS),
    classes: readAllAsObjects_(getTab_(ss, TABS.CLASSES), HEADERS.CLASSES),
    enrollments: readAllAsObjects_(getTab_(ss, TABS.ENROLLMENTS), HEADERS.ENROLLMENTS),
  };
  return _rosterMemo;
}

function invalidateRosterMemo_() { _rosterMemo = null; }

// =====================================================================
// Query helpers.
// =====================================================================

function getStudentIdentity_(email) {
  const t = String(email || '').toLowerCase();
  return rosterData_().students.find((s) => String(s.Email).toLowerCase() === t) || null;
}

/** Distinct class names the student is enrolled in (any status). */
function getStudentClasses_(email) {
  const t = String(email || '').toLowerCase();
  const seen = new Set();
  rosterData_().enrollments.forEach((e) => {
    if (String(e.Email).toLowerCase() === t) {
      const c = String(e.Class).trim();
      if (c) seen.add(c);
    }
  });
  return [...seen];
}

/** TeacherEmail for a class name (lowercased), or '' if unknown. */
function classTeacher_(className) {
  const name = String(className || '').trim();
  if (!name) return '';
  const c = rosterData_().classes.find((x) => String(x.Class).trim() === name);
  return c ? String(c.TeacherEmail || '').toLowerCase() : '';
}

/**
 * Compat shim for the old flat lookup. Returns null if the email isn't a known
 * student, else identity + the FULL class list plus single-value compat fields
 * (`.Class`/`.Teacher`/`.TeacherEmail` = the student's first class). New callers
 * should use `.classes` (array). Mirrors the old shape's First/Last/ID/Email.
 */
function getStudentRosterEntry_(email) {
  const id = getStudentIdentity_(email);
  if (!id) return null;
  const classes = getStudentClasses_(email);
  const first = classes[0] || '';
  const teacher = classTeacher_(first);
  return {
    Name: [id.First, id.Last].filter(Boolean).join(' ').trim(),
    ID: id.ID, First: id.First, Last: id.Last, Email: id.Email,
    classes: classes,        // NEW — full membership
    Class: first,            // compat — first class
    Teacher: teacher,        // compat — class teacher email (display name no longer stored per-student)
    TeacherEmail: teacher,   // compat
  };
}

/** All class records (metadata). Name falls back to the Class key for legacy rows. */
function listClasses_() {
  return rosterData_().classes.map((c) => ({
    Class: String(c.Class || '').trim(),
    TeacherEmail: String(c.TeacherEmail || '').toLowerCase(),
    SchoolYear: String(c.SchoolYear || ''),
    Status: String(c.Status || CLASS_STATUS.ACTIVE),
    Name: String(c.Name || '').trim() || String(c.Class || '').trim(),
    Period: String(c.Period || '').trim(),
  }));
}

/** Display label for a class record: "Name · Period" (Period omitted when blank). */
function classDisplayLabel_(rec) {
  return rec.Period ? rec.Name + ' · ' + rec.Period : rec.Name;
}

/** One class record by name, or null. */
function getClassRecord_(name) {
  const n = String(name || '').trim();
  if (!n) return null;
  return listClasses_().find((c) => c.Class === n) || null;
}

/** Distinct class names taught by this teacher (from the Classes tab). */
function listClassesTaughtBy_(email) {
  const t = String(email || '').toLowerCase();
  return listClasses_().filter((c) => c.TeacherEmail === t).map((c) => c.Class).filter(Boolean);
}

/** Emails enrolled in a class. */
function enrollmentsForClass_(className) {
  const name = String(className || '').trim();
  const seen = new Set();
  rosterData_().enrollments.forEach((e) => {
    if (String(e.Class).trim() === name) seen.add(String(e.Email).toLowerCase());
  });
  return [...seen];
}

/**
 * Students enrolled in ANY of the given classes, deduped by email, each tagged
 * with the subset of those classes they're in (for dashboard grouping). Drives
 * `dashboardEnrolled_` / project rosters.
 */
function studentsInClasses_(classNames) {
  const scope = new Set((classNames || []).map((c) => String(c).trim()).filter(Boolean));
  const byEmail = {};
  rosterData_().enrollments.forEach((e) => {
    const c = String(e.Class).trim();
    if (!scope.has(c)) return;
    const em = String(e.Email).toLowerCase();
    (byEmail[em] || (byEmail[em] = [])).push(c);
  });
  return Object.keys(byEmail).map((em) => {
    const id = getStudentIdentity_(em) || { ID: '', First: '', Last: '', Email: em };
    return { ID: id.ID, First: id.First, Last: id.Last, Email: em, classes: byEmail[em] };
  });
}

// =====================================================================
// Write helpers (used by the admin Classes endpoints — Track C).
// =====================================================================

function clearDataRows_(tab) {
  const last = tab.getLastRow();
  if (last >= 2) tab.deleteRows(2, last - 1);
}

/** Delete every data row matching predicate(obj). Returns count deleted. */
function deleteRowsWhere_(tab, headers, predicate) {
  if (tab.getLastRow() < 2) return 0;
  const values = tab.getRange(2, 1, tab.getLastRow() - 1, headers.length).getValues();
  const toDelete = [];
  for (let i = 0; i < values.length; i++) {
    if (predicate(rowToObj_(headers, values[i]))) toDelete.push(i + 2);
  }
  for (let j = toDelete.length - 1; j >= 0; j--) tab.deleteRow(toDelete[j]);
  return toDelete.length;
}

/**
 * Legacy create: the given name IS the key (Name = name, Period = ''). Kept for
 * dev fixtures / sample data / the flat-roster import, where the string is
 * already unique. New admin-facing creates go through createClassV2_.
 */
function createClass_(name, teacherEmail, schoolYear) {
  const cls = String(name || '').trim();
  if (!cls) throw new Error('Class name required');
  return appendClassRow_({
    Class: cls,
    TeacherEmail: String(teacherEmail || '').trim().toLowerCase(),
    SchoolYear: String(schoolYear || ''),
    Status: CLASS_STATUS.ACTIVE,
    Name: cls,
    Period: '',
  });
}

/**
 * PURE: compose the immutable Class key from display parts.
 *   composeClassKeyParts_('US History', 'P3', 'Ivers') → 'US History P3 — Ivers'
 * Period and teacherLastName are each optional.
 */
function composeClassKeyParts_(name, period, teacherLastName) {
  let key = String(name || '').trim();
  const p = String(period || '').trim();
  const t = String(teacherLastName || '').trim();
  if (p) key += ' ' + p;
  if (t) key += ' — ' + t;
  return key;
}

/**
 * PURE: split a legacy class string into {name, period} by peeling a trailing
 * period-ish token (P3 / Period 3 / Per 3 / Hour 3 / Block A). Unparseable →
 * the whole string as name, blank period. Used by migrateClassNamePeriod.
 */
function parseClassNamePeriod_(cls) {
  const s = String(cls || '').trim();
  const m = s.match(/^(.*?)[\s\-–—·,]*((?:P|Per|Period)\.?\s*\d+|Hour\s*\d+|Block\s*[A-Za-z0-9])\s*$/i);
  if (m && m[1].trim()) {
    return { name: m[1].trim().replace(/[\-–—·,]+$/, '').trim(), period: normalizePeriodToken_(m[2]) };
  }
  return { name: s, period: '' };
}

/** PURE: 'Period 3' / 'per3' / 'p 3' → 'P3'; 'Hour 3' / 'Block A' pass through tidied. */
function normalizePeriodToken_(tok) {
  const s = String(tok || '').trim().replace(/\s+/g, ' ');
  const p = s.match(/^(?:P|Per|Period)\.?\s*(\d+)$/i);
  if (p) return 'P' + p[1];
  const h = s.match(/^Hour\s*(\d+)$/i);
  if (h) return 'Hour ' + h[1];
  const b = s.match(/^Block\s*([A-Za-z0-9])$/i);
  if (b) return 'Block ' + b[1].toUpperCase();
  return s;
}

/** Last whitespace token of the teacher's Staff display name, or '' if unknown. */
function teacherLastNameFor_(email) {
  const em = String(email || '').trim().toLowerCase();
  if (!em) return '';
  const staff = readAllAsObjects_(getTab_(rosterWorkbook_(), TABS.STAFF), HEADERS.STAFF)
    .find((s) => String(s.Email || '').toLowerCase() === em);
  if (!staff) return '';
  const parts = String(staff.Name || '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/**
 * v2 create: display fields in, system-composed immutable key out.
 * Uniqueness is (Name, Period, TeacherEmail), case-insensitive. If the composed
 * key still collides with an existing row (two teachers sharing a last name),
 * the email local part is appended to keep the key unique.
 */
function createClassV2_(args) {
  const name = String((args && args.name) || '').trim();
  if (!name) throw new Error('Class name required');
  const period = normalizePeriodToken_((args && args.period) || '');
  const teacherEmail = String((args && args.teacherEmail) || '').trim().toLowerCase();
  ensureClassSchema_();

  const dupe = listClasses_().find((c) =>
    c.Name.toLowerCase() === name.toLowerCase() &&
    c.Period.toLowerCase() === period.toLowerCase() &&
    c.TeacherEmail === teacherEmail);
  if (dupe) {
    throw new Error('That class already exists: ' + classDisplayLabel_(dupe) +
      (teacherEmail ? ' (' + teacherEmail + ')' : ''));
  }

  let key = composeClassKeyParts_(name, period, teacherLastNameFor_(teacherEmail));
  if (getClassRecord_(key)) {
    key = composeClassKeyParts_(name, period, teacherLastNameFor_(teacherEmail)) +
      ' (' + (teacherEmail.split('@')[0] || 'x') + ')';
    if (getClassRecord_(key)) throw new Error('Class key collision: ' + key);
  }

  return appendClassRow_({
    Class: key,
    TeacherEmail: teacherEmail,
    SchoolYear: String((args && args.schoolYear) || ''),
    Status: CLASS_STATUS.ACTIVE,
    Name: name,
    Period: period,
  });
}

function appendClassRow_(rec) {
  ensureClassSchema_();
  const tab = getTab_(rosterWorkbook_(), TABS.CLASSES);
  const existing = readAllAsObjects_(tab, HEADERS.CLASSES);
  if (existing.some((c) => String(c.Class).trim().toLowerCase() === rec.Class.toLowerCase())) {
    throw new Error('Class already exists: ' + rec.Class);
  }
  appendRow_(tab, HEADERS.CLASSES, rec);
  invalidateRosterMemo_();
  return rec;
}

/**
 * Update a class's TeacherEmail / SchoolYear / Status / Name / Period. The
 * Class KEY never changes (it's the join value everywhere) — Name/Period are
 * display-only, so renames are safe.
 */
function updateClass_(name, fields) {
  ensureClassSchema_();
  const tab = getTab_(rosterWorkbook_(), TABS.CLASSES);
  const idx = findRowByKeyCi_(tab, HEADERS.CLASSES, 'Class', name);
  if (idx < 0) throw new Error('No such class: ' + name);
  const cur = rowToObj_(HEADERS.CLASSES, tab.getRange(idx, 1, 1, HEADERS.CLASSES.length).getValues()[0]);
  if ('TeacherEmail' in fields) cur.TeacherEmail = String(fields.TeacherEmail || '').trim().toLowerCase();
  if ('SchoolYear' in fields) cur.SchoolYear = String(fields.SchoolYear || '');
  if ('Status' in fields) cur.Status = String(fields.Status || CLASS_STATUS.ACTIVE);
  if ('Name' in fields) {
    const nn = String(fields.Name || '').trim();
    if (!nn) throw new Error('Class name cannot be blank');
    cur.Name = nn;
  }
  if ('Period' in fields) cur.Period = normalizePeriodToken_(fields.Period || '');
  tab.getRange(idx, 1, 1, HEADERS.CLASSES.length).setValues([HEADERS.CLASSES.map((h) => cur[h])]);
  invalidateRosterMemo_();
  return cur;
}

/**
 * One-time, idempotent, editor-callable: backfill Name/Period on legacy class
 * rows by parsing a trailing period token out of the Class key. Rows that
 * already have a Name are left alone. Safe to re-run.
 */
function migrateClassNamePeriod() {
  ensureClassSchema_();
  const tab = getTab_(rosterWorkbook_(), TABS.CLASSES);
  const nameCol = HEADERS.CLASSES.indexOf('Name') + 1;
  const periodCol = HEADERS.CLASSES.indexOf('Period') + 1;
  const rows = readAllAsObjects_(tab, HEADERS.CLASSES);
  let healed = 0;
  rows.forEach((r, i) => {
    if (String(r.Name || '').trim()) return;
    const parsed = parseClassNamePeriod_(r.Class);
    tab.getRange(i + 2, nameCol).setValue(parsed.name);
    if (parsed.period) tab.getRange(i + 2, periodCol).setValue(parsed.period);
    healed++;
  });
  invalidateRosterMemo_();
  Logger.log('migrateClassNamePeriod: backfilled ' + healed + ' of ' + rows.length + ' rows');
  return { ok: true, healed, total: rows.length };
}

/** Remove a class + all its enrollments. (Projects referencing it by name are left intact.) */
function deleteClass_(name) {
  ensureClassSchema_();
  const ss = rosterWorkbook_();
  const cls = String(name || '').trim();
  deleteRowsWhere_(getTab_(ss, TABS.CLASSES), HEADERS.CLASSES, (r) => String(r.Class).trim() === cls);
  const removed = deleteRowsWhere_(getTab_(ss, TABS.ENROLLMENTS), HEADERS.ENROLLMENTS, (r) => String(r.Class).trim() === cls);
  invalidateRosterMemo_();
  return { ok: true, removedEnrollments: removed };
}

/** Enroll a student in a class (idempotent). */
function enroll_(email, className) {
  ensureClassSchema_();
  const em = String(email || '').trim().toLowerCase();
  const cls = String(className || '').trim();
  if (!em || !cls) throw new Error('email and class required');
  const tab = getTab_(rosterWorkbook_(), TABS.ENROLLMENTS);
  const exists = readAllAsObjects_(tab, HEADERS.ENROLLMENTS)
    .some((e) => String(e.Email).toLowerCase() === em && String(e.Class).trim() === cls);
  if (!exists) appendRow_(tab, HEADERS.ENROLLMENTS, { Email: em, Class: cls });
  invalidateRosterMemo_();
  return { ok: true };
}

/**
 * Enroll many students in a class in ONE batched append (skips those already
 * enrolled). Returns the number newly enrolled. Used by the bulk class import so
 * a 30-student paste is a single write, not 30.
 */
function enrollMany_(emails, className) {
  ensureClassSchema_();
  const cls = String(className || '').trim();
  if (!cls) throw new Error('class required');
  const tab = getTab_(rosterWorkbook_(), TABS.ENROLLMENTS);
  const have = new Set(
    readAllAsObjects_(tab, HEADERS.ENROLLMENTS)
      .filter((e) => String(e.Class).trim() === cls)
      .map((e) => String(e.Email).toLowerCase())
  );
  const emailCol = HEADERS.ENROLLMENTS.indexOf('Email');
  const toAdd = [];
  (emails || []).forEach((em) => {
    const e = String(em || '').trim().toLowerCase();
    if (e && !have.has(e)) {
      have.add(e);
      const row = []; row[emailCol] = e; row[HEADERS.ENROLLMENTS.indexOf('Class')] = cls;
      toAdd.push(HEADERS.ENROLLMENTS.map((h, i) => row[i] || ''));
    }
  });
  if (toAdd.length) {
    tab.getRange(tab.getLastRow() + 1, 1, toAdd.length, HEADERS.ENROLLMENTS.length).setValues(toAdd);
  }
  invalidateRosterMemo_();
  return toAdd.length;
}

/** Remove a student from a class (idempotent). */
function unenroll_(email, className) {
  ensureClassSchema_();
  const em = String(email || '').trim().toLowerCase();
  const cls = String(className || '').trim();
  const n = deleteRowsWhere_(getTab_(rosterWorkbook_(), TABS.ENROLLMENTS), HEADERS.ENROLLMENTS,
    (r) => String(r.Email).toLowerCase() === em && String(r.Class).trim() === cls);
  invalidateRosterMemo_();
  return { ok: true, removed: n };
}

/** Set a student's full class set (diff add/remove). */
function setStudentClasses_(email, classNames) {
  ensureClassSchema_();
  const em = String(email || '').trim().toLowerCase();
  const want = new Set((classNames || []).map((c) => String(c).trim()).filter(Boolean));
  const have = new Set(getStudentClasses_(em));
  have.forEach((c) => { if (!want.has(c)) unenroll_(em, c); });
  want.forEach((c) => { if (!have.has(c)) enroll_(em, c); });
  invalidateRosterMemo_();
  return { ok: true, classes: [...want] };
}

/** Upsert a student identity row (keyed by Email). */
function upsertStudent_(student) {
  ensureClassSchema_();
  const em = String(student.Email || '').trim().toLowerCase();
  if (!em) throw new Error('Email required');
  upsertByKey_(getTab_(rosterWorkbook_(), TABS.STUDENTS), HEADERS.STUDENTS, 'Email', {
    ID: String(student.ID || '').trim(),
    First: String(student.First || '').trim(),
    Last: String(student.Last || '').trim(),
    Email: em,
  });
  invalidateRosterMemo_();
  return { ok: true };
}

/** Remove a student + all their enrollments. */
function deleteStudent_(email) {
  ensureClassSchema_();
  const ss = rosterWorkbook_();
  const em = String(email || '').trim().toLowerCase();
  deleteRowsWhere_(getTab_(ss, TABS.STUDENTS), HEADERS.STUDENTS, (r) => String(r.Email).toLowerCase() === em);
  deleteRowsWhere_(getTab_(ss, TABS.ENROLLMENTS), HEADERS.ENROLLMENTS, (r) => String(r.Email).toLowerCase() === em);
  invalidateRosterMemo_();
  return { ok: true };
}

/**
 * Wholesale replace from a flat import (one row per (student,class)).
 * Rebuilds the trio via the pure transform. Class metadata not in the import
 * (SchoolYear) is reset — this is a deliberate full replace.
 */
function replaceRoster_(rows) {
  ensureClassSchema_();
  const built = buildClassSchemaFromLegacy_(rows);
  const ss = rosterWorkbook_();
  const sTab = getTab_(ss, TABS.STUDENTS);
  const cTab = getTab_(ss, TABS.CLASSES);
  const eTab = getTab_(ss, TABS.ENROLLMENTS);
  clearDataRows_(sTab); clearDataRows_(cTab); clearDataRows_(eTab);
  built.students.forEach((s) => appendRow_(sTab, HEADERS.STUDENTS, s));
  built.classes.forEach((c) => appendRow_(cTab, HEADERS.CLASSES, c));
  built.enrollments.forEach((e) => appendRow_(eTab, HEADERS.ENROLLMENTS, e));
  invalidateRosterMemo_();
  return { ok: true, students: built.students.length, classes: built.classes.length, enrollments: built.enrollments.length };
}
