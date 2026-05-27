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

/** Return {Name, Email, Class, Teacher} or null. */
function getStudentRosterEntry_(email) {
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.ROSTER);
  const rows = readAllAsObjects_(tab, HEADERS.ROSTER);
  const target = String(email).toLowerCase();
  return rows.find((r) => String(r.Email).toLowerCase() === target) || null;
}

/** Return {Name, Email, Role} or null. */
function getStaffEntry_(email) {
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.STAFF);
  const rows = readAllAsObjects_(tab, HEADERS.STAFF);
  const target = String(email).toLowerCase();
  return rows.find((r) => String(r.Email).toLowerCase() === target) || null;
}

function isStaff_(email) {
  const e = getStaffEntry_(email);
  return !!e;
}

function isAdmin_(email) {
  const e = getStaffEntry_(email);
  return !!e && e.Role === ROLES.ADMIN;
}

/**
 * Validate the roster: every email present, unique, lowercase-comparable; every
 * student row has First/Last/Class/TeacherEmail. ID optional but must be unique
 * when present. Returns {ok, errors}.
 * Run from the editor or from setup() after wholesale roster replacement.
 */
function validateRoster() {
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const roster = readAllAsObjects_(getTab_(ss, TABS.ROSTER), HEADERS.ROSTER);
  const staff = readAllAsObjects_(getTab_(ss, TABS.STAFF), HEADERS.STAFF);
  const errors = [];
  const emailSeen = new Set();
  const idSeen = new Set();
  roster.forEach((r, i) => {
    const rowNum = i + 2;
    if (!r.Email) errors.push(`Roster row ${rowNum}: blank Email`);
    if (!r.First) errors.push(`Roster row ${rowNum}: blank First`);
    if (!r.Last)  errors.push(`Roster row ${rowNum}: blank Last`);
    if (!r.Class) errors.push(`Roster row ${rowNum}: blank Class`);
    if (!r.TeacherEmail) errors.push(`Roster row ${rowNum}: blank TeacherEmail`);
    const e = String(r.Email || '').toLowerCase();
    if (e && emailSeen.has(e)) errors.push(`Roster row ${rowNum}: duplicate Email ${e}`);
    emailSeen.add(e);
    const id = String(r.ID || '').trim();
    if (id) {
      if (idSeen.has(id)) errors.push(`Roster row ${rowNum}: duplicate ID ${id}`);
      idSeen.add(id);
    }
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
  const result = { ok: errors.length === 0, errors, rosterCount: roster.length, staffCount: staff.length };
  console.log(JSON.stringify(result, null, 2));
  return result;
}
