/**
 * Teacher "Manage roster" — the dashboard modal's class-scoped enroll/unenroll.
 *
 * Teachers may only touch classes whose TeacherEmail is them; admins any class.
 * Add enrolls an EXISTING district student only (creating Students rows stays
 * admin-only). Remove = unenroll only: per-project Sheets are kept, and
 * findSoloSheetInProject_ (class-agnostic Drive walk) finds them again on
 * re-enroll. A grouped student leaves the group FIRST via the existing
 * removeMemberFromGroupCore_ so their work is rebuilt into a solo Sheet — that
 * rebuild files the Sheet under a class the student still shares with the
 * project, so it must run before the enrollment row is dropped.
 *
 * Writes go through enroll_/unenroll_ (40_roster_model.js), which drop the
 * roster memo + CacheService entry. The dashboard's 45s scope-keyed cache isn't
 * enumerable; the client re-fetches its current view with bypassCache after a
 * change, other scopes age out within the TTL.
 */

var ROSTER_NOT_FOUND_MSG = 'No student with that email in the district roster — ask an admin to add them.';

/** Pure: may this actor edit this class's enrollments? classRec = listClasses_() row or null. */
function canEditClassRoster_(actorEmail, isAdmin, classRec) {
  if (!classRec) return false;
  if (isAdmin) return true;
  const a = String(actorEmail || '').trim().toLowerCase();
  return !!a && String(classRec.TeacherEmail || '').trim().toLowerCase() === a;
}

/** Pure: trimmed + lowercased email, or '' if it isn't email-shaped. */
function normalizeRosterEmail_(raw) {
  const e = String(raw || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : '';
}

/**
 * Pure: which of a project's groups the student must leave when unenrolled from
 * classKey. A group is filed under one class folder (g.className); leave it if
 * it's this class, or if the student shares no other class with the project.
 */
function groupsToLeaveOnUnenroll_(groups, email, classKey, remainingProjectClasses) {
  const e = String(email || '').toLowerCase();
  const orphaned = !(remainingProjectClasses || []).length;
  return (groups || []).filter((g) =>
    (g.memberEmails || []).some((m) => String(m).toLowerCase() === e) &&
    (orphaned || g.className === classKey));
}

/** Pure: roster rows → client rows sorted Last, First (nameless rows last, by email). No Dates. */
function shapeClassRosterRows_(students) {
  const cmp = (x, y) => x.toLowerCase().localeCompare(y.toLowerCase());
  return (students || []).map((s) => ({
    email: String(s.Email || '').toLowerCase(),
    first: String(s.First || ''),
    last: String(s.Last || ''),
    name: composeStudentName_(s),
  })).sort((a, b) => {
    const an = !(a.last || a.first), bn = !(b.last || b.first);
    if (an !== bn) return an ? 1 : -1;
    return cmp(a.last, b.last) || cmp(a.first, b.first) || cmp(a.email, b.email);
  });
}

/** Server-side gate shared by all three endpoints. Returns {actorEmail, cls}. */
function assertCanEditClassRoster_(classKey) {
  const actorEmail = getActorEmail_();
  const staff = assertStaff_(actorEmail);
  const key = String(classKey || '').trim();
  if (!key) throw new Error('class required');
  const cls = getClassRecord_(key);
  if (!cls) throw new Error('No such class: ' + key);
  if (!canEditClassRoster_(actorEmail, isAdmin_(staff), cls)) throw new Error('Class not in your scope');
  return { actorEmail, cls };
}

function classRosterPayload_(cls) {
  return {
    ok: true,
    classKey: cls.Class,
    label: classDisplayLabel_(cls),
    students: shapeClassRosterRows_(excludeSampleIfDisabled_(studentsInClasses_([cls.Class]))),
  };
}

/** Students enrolled in one class (sample students hidden when the toggle is off). */
function consoleGetClassRoster(classKey) {
  const a = assertCanEditClassRoster_(classKey);
  return classRosterPayload_(a.cls);
}

/**
 * Enroll an existing district student. Unknown email → {ok:false, reason:'not_found'}
 * (a normal outcome, not a thrown error, so the modal shows it inline).
 */
function consoleEnrollStudentInClass(classKey, email) {
  const a = assertCanEditClassRoster_(classKey);
  const em = normalizeRosterEmail_(email);
  if (!em) return { ok: false, reason: 'invalid', message: 'Enter a full email address.' };
  if (!getStudentIdentity_(em)) return { ok: false, reason: 'not_found', message: ROSTER_NOT_FOUND_MSG };
  const cls = a.cls.Class;
  if (enrollmentsForClass_(cls).indexOf(em) >= 0) {
    return Object.assign(classRosterPayload_(a.cls), { email: em, alreadyEnrolled: true });
  }
  enroll_(em, cls);
  appendAuditEvent_({
    projectId: '', action: AUDIT_ACTIONS.ROSTER_ENROLL,
    actor: a.actorEmail, detail: 'class=' + cls + ';email=' + em,
  });
  return Object.assign(classRosterPayload_(a.cls), { email: em, alreadyEnrolled: false });
}

/**
 * Unenroll a student. Leaves any affected group first (active projects that
 * include this class), then drops the enrollment row. Sheets are never trashed.
 * Returns the refreshed roster + leftGroups:[{projectId, groupId, autoDisbanded}].
 */
function consoleUnenrollStudentFromClass(classKey, email) {
  const a = assertCanEditClassRoster_(classKey);
  const em = String(email || '').trim().toLowerCase();
  if (!em) throw new Error('email required');
  const cls = a.cls.Class;
  if (enrollmentsForClass_(cls).indexOf(em) < 0) {
    return Object.assign(classRosterPayload_(a.cls), { email: em, removed: 0, leftGroups: [] });
  }

  const otherClasses = getStudentClasses_(em).filter((c) => c !== cls);
  const leftGroups = [];
  listActiveProjects_().forEach((project) => {
    const projectClasses = projectClassList_(project);
    if (projectClasses.indexOf(cls) < 0) return;
    resetGroupSheetCache_();
    const remaining = otherClasses.filter((c) => projectClasses.indexOf(c) >= 0);
    groupsToLeaveOnUnenroll_(listGroupsForProject_(project), em, cls, remaining).forEach((g) => {
      const group = findGroupFileByGroupId_(project, g.groupId);
      if (!group) return;
      group.groupId = g.groupId;
      withGroupLock_(() => {
        // Re-check under the lock — a concurrent teacher action may have moved them.
        if (!currentMembers_(group.spreadsheet).some((m) => String(m.email).toLowerCase() === em)) return;
        const r = removeMemberFromGroupCore_(project, group, em, a.actorEmail);
        leftGroups.push({ projectId: project.projectId, groupId: g.groupId, autoDisbanded: !!r.autoDisbanded });
      });
      resetGroupSheetCache_();
    });
  });

  const res = unenroll_(em, cls);
  appendAuditEvent_({
    projectId: '', action: AUDIT_ACTIONS.ROSTER_UNENROLL, actor: a.actorEmail,
    detail: 'class=' + cls + ';email=' + em +
      (leftGroups.length ? ';leftGroups=' + leftGroups.map((x) => x.groupId).join(',') : ''),
  });
  return Object.assign(classRosterPayload_(a.cls), { email: em, removed: res.removed, leftGroups });
}
