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

/**
 * Projects the caller has access to. Teachers see projects whose
 * memberClasses intersect classes they teach; admins see all.
 *
 * filter: 'active' (default) or 'archived'.
 *
 * Per spec §6: the project list is read-light. No per-student-sheet opens
 * happen here. Each card's studentCount is computed from the Roster
 * (rows whose Class ∈ memberClasses ∩ teacherClasses).
 */
function consoleGetMyProjects(filter) {
  const actorEmail = getActorEmail_();
  const staff = assertStaff_(actorEmail);
  const wantStatus = (filter === 'archived') ? PROJECT_STATUS.ARCHIVED : PROJECT_STATUS.ACTIVE;

  const all = listProjects_();
  const bundles = listBundles_();
  const bundleById = {};
  bundles.forEach((b) => { bundleById[b.bundleId] = b; });

  const teacherClasses = isAdmin_(staff) ? null : listClassesTaughtBy_(actorEmail);

  const rosterRows = readAllAsObjects_(
    getTab_(SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID), TABS.ROSTER),
    HEADERS.ROSTER
  );

  const visible = all.filter((p) => {
    if (p.status !== wantStatus) return false;
    if (isAdmin_(staff)) return true;
    const projectClasses = projectClassList_(p);
    return projectClasses.some((c) => teacherClasses.indexOf(c) >= 0);
  });

  const projects = visible.map((p) => {
    const projectClasses = projectClassList_(p);
    const scopedClasses = isAdmin_(staff)
      ? projectClasses
      : projectClasses.filter((c) => teacherClasses.indexOf(c) >= 0);
    const studentCount = rosterRows.filter(
      (r) => r.Class && scopedClasses.indexOf(String(r.Class).trim()) >= 0
    ).length;
    const bundle = bundleById[p.bundleId] || null;
    return {
      projectId: p.projectId,
      name: p.name,
      schoolYear: p.schoolYear,
      bundleId: p.bundleId,
      bundleName: bundle ? bundle.name : '(unknown bundle)',
      memberClasses: projectClasses,
      scopedClasses,         // classes the caller actually sees
      studentCount,
      status: p.status,
    };
  });

  // Sort: schoolYear desc, then name asc.
  projects.sort((a, b) => {
    if (a.schoolYear !== b.schoolYear) return a.schoolYear > b.schoolYear ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { ok: true, projects };
}

/** Parse a project's comma-separated memberClasses into a trimmed string array. */
function projectClassList_(project) {
  return String(project.memberClasses || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
