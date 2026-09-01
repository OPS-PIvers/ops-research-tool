/**
 * Identity, roster lookup, staff lookup, simple validators.
 * Email is the join key everywhere. Names come from the roster, never from
 * the email (district emails are opaque IDs).
 */

/** Email of the user making the current request. Throws if blank. */
function getActorEmail_() {
  const email = Session.getActiveUser().getEmail();
  if (!email) {
    throw new Error(
      'Could not determine the calling user. Web App must be deployed with ' +
      '"Execute as: Me" + "Who has access: Anyone within domain", and the caller ' +
      'must be signed into a Google account in the same domain.'
    );
  }
  return email.toLowerCase();
}

// getStudentRosterEntry_ now lives in 40_roster_model.js (Classes v2): it is
// backed by the Students/Enrollments tabs and returns a `.classes` array plus
// single-value compat fields. Defined there, not here, to avoid same-name
// shadowing (CLAUDE.md §5).

/** Return {Name, Email, Role} or null. */
var STAFF_CACHE_TTL_SEC = 120;

/** All Staff rows, cached (05_cache.js). Admin staff writes call invalidateStaffCache_. */
function listStaffRows_() {
  return cachedJson_('staff', STAFF_CACHE_TTL_SEC, () => {
    const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
    return readAllAsObjects_(getTab_(ss, TABS.STAFF), HEADERS.STAFF);
  });
}

function getStaffEntry_(email) {
  const target = String(email).toLowerCase();
  return listStaffRows_().find((r) => String(r.Email).toLowerCase() === target) || null;
}

function isStaff_(email) {
  const e = getStaffEntry_(email);
  return !!e;
}

/**
 * Throws 'Not authorized' if the caller isn't on Staff at all, or
 * 'Admin only' if the caller is staff but not an admin. Returns the
 * staff entry so callers can read .Email / .Name without re-fetching.
 *
 * The two error messages are deliberately distinct so the client toast
 * can communicate "you're not staff at all" vs. "you're a teacher,
 * this surface is admin-only".
 */
function assertAdmin_(actorEmail) {
  const staff = getStaffEntry_(actorEmail);
  if (!staff) throw new Error('Not authorized');
  if (staff.Role !== ROLES.ADMIN) throw new Error('Admin only');
  return staff;
}

/**
 * Validate the v2 roster model (Students / Classes / Enrollments / Staff):
 * - Students: Email present + unique; First/Last present; ID unique when set.
 * - Classes: Class name unique; TeacherEmail present.
 * - Enrollments: Email references a Student; Class references a Class.
 * - Staff: Email present + unique; Role in {teacher, admin}.
 * Returns {ok, errors, ...counts}. Run from the editor or after a replace.
 */
function validateRoster() {
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  ensureClassSchema_();
  const students = readAllAsObjects_(getTab_(ss, TABS.STUDENTS), HEADERS.STUDENTS);
  const classes = readAllAsObjects_(getTab_(ss, TABS.CLASSES), HEADERS.CLASSES);
  const enrollments = readAllAsObjects_(getTab_(ss, TABS.ENROLLMENTS), HEADERS.ENROLLMENTS);
  const staff = readAllAsObjects_(getTab_(ss, TABS.STAFF), HEADERS.STAFF);
  const errors = [];

  const emailSeen = new Set();
  const idSeen = new Set();
  students.forEach((r, i) => {
    const rowNum = i + 2;
    if (!r.Email) errors.push(`Students row ${rowNum}: blank Email`);
    if (!r.First) errors.push(`Students row ${rowNum}: blank First`);
    if (!r.Last)  errors.push(`Students row ${rowNum}: blank Last`);
    const e = String(r.Email || '').toLowerCase();
    if (e && emailSeen.has(e)) errors.push(`Students row ${rowNum}: duplicate Email ${e}`);
    emailSeen.add(e);
    const id = String(r.ID || '').trim();
    if (id) {
      if (idSeen.has(id)) errors.push(`Students row ${rowNum}: duplicate ID ${id}`);
      idSeen.add(id);
    }
  });

  const classSeen = new Set();
  classes.forEach((r, i) => {
    const rowNum = i + 2;
    const c = String(r.Class || '').trim();
    if (!c) errors.push(`Classes row ${rowNum}: blank Class`);
    if (!r.TeacherEmail) errors.push(`Classes row ${rowNum}: blank TeacherEmail`);
    if (c && classSeen.has(c.toLowerCase())) errors.push(`Classes row ${rowNum}: duplicate Class ${c}`);
    classSeen.add(c.toLowerCase());
  });

  enrollments.forEach((r, i) => {
    const rowNum = i + 2;
    const e = String(r.Email || '').toLowerCase();
    const c = String(r.Class || '').trim();
    if (!e) errors.push(`Enrollments row ${rowNum}: blank Email`);
    else if (!emailSeen.has(e)) errors.push(`Enrollments row ${rowNum}: Email ${e} not in Students`);
    if (!c) errors.push(`Enrollments row ${rowNum}: blank Class`);
    else if (!classSeen.has(c.toLowerCase())) errors.push(`Enrollments row ${rowNum}: Class ${c} not in Classes`);
  });

  const staffSeen = new Set();
  staff.forEach((r, i) => {
    const rowNum = i + 2;
    if (!r.Email) errors.push(`Staff row ${rowNum}: blank Email`);
    if (!r.Role)  errors.push(`Staff row ${rowNum}: blank Role`);
    if (r.Role && r.Role !== ROLES.TEACHER && r.Role !== ROLES.ADMIN) {
      errors.push(`Staff row ${rowNum}: bad Role "${r.Role}" (must be teacher|admin)`);
    }
    const e = String(r.Email || '').toLowerCase();
    if (e && staffSeen.has(e)) errors.push(`Staff row ${rowNum}: duplicate Email ${e}`);
    staffSeen.add(e);
  });

  const result = {
    ok: errors.length === 0, errors,
    studentCount: students.length, classCount: classes.length,
    enrollmentCount: enrollments.length, staffCount: staff.length,
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}
