/**
 * Teacher Console endpoints — called from the Console HTML via
 * google.script.run. All endpoints share the same auth pattern:
 *
 *   const actorEmail = getActorEmail_();
 *   const staff = assertStaff_(actorEmail);   // throws 'Not authorized' if null
 *
 * Identity comes from the GAS session. Clients cannot spoof; non-staff
 * users hitting the URL or crafting manual google.script.run calls are
 * rejected at the server.
 */

/**
 * Bootstrap data: caller identity + staff entry + role + classes the
 * caller teaches. The Console JS gates the UI on `staff === null`.
 */
function consoleGetContext() {
  const actorEmail = getActorEmail_();
  const staff = getStaffEntry_(actorEmail);
  if (!staff) {
    return { ok: true, actor: actorEmail, staff: null, role: null, teacherClasses: [] };
  }
  const role = staff.Role === ROLES.ADMIN ? 'admin' : 'teacher';
  const teacherClasses = role === 'admin' ? null : listClassesTaughtBy_(actorEmail);
  return { ok: true, actor: actorEmail, staff, role, teacherClasses };
}

/**
 * Classes whose Teacher column equals this email in the Roster.
 * Distinct, trimmed, non-empty. Returns [] if the actor teaches nothing.
 */
function listClassesTaughtBy_(actorEmail) {
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const rows = readAllAsObjects_(getTab_(ss, TABS.ROSTER), HEADERS.ROSTER);
  const set = {};
  rows.forEach((r) => {
    if (r.Teacher && String(r.Teacher).trim().toLowerCase() === actorEmail.toLowerCase()) {
      const cls = String(r.Class || '').trim();
      if (cls) set[cls] = true;
    }
  });
  return Object.keys(set).sort();
}

/**
 * Throws 'Not authorized' if the caller isn't on the Staff sheet. Returns
 * the staff entry so callers can read .Role without re-fetching.
 */
function assertStaff_(actorEmail) {
  const staff = getStaffEntry_(actorEmail);
  if (!staff) throw new Error('Not authorized');
  return staff;
}

/** Convenience: true iff the staff entry's Role is admin. */
function isAdmin_(staff) {
  return staff && staff.Role === ROLES.ADMIN;
}
