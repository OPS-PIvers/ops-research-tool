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

var ROSTER_OTHER_TEACHER_MSG = 'That student is in another teacher\'s class in a project you share — ask an admin to move them.';

/**
 * Pure: would enrolling this student into classKey hand the actor access to a
 * student another teacher already has in a SHARED active project? The
 * drill-down authorizes a teacher who teaches any project class the student is
 * in, and the student's Sheet is found by email, not class — so a teacher
 * could otherwise enroll someone else's student and read their work.
 *   projects       = [{ classes:[...] }] active projects (class keys)
 *   studentClasses = the student's current class keys
 *   teacherOf      = classKey → TeacherEmail (lowercased)
 * Admins never call this (they may move anyone).
 */
function enrollConflictsWithOtherTeacher_(actorEmail, classKey, studentClasses, projects, teacherOf) {
  const a = String(actorEmail || '').trim().toLowerCase();
  const others = (studentClasses || []).filter((c) =>
    c !== classKey && String(teacherOf[c] || '').toLowerCase() !== a);
  if (!others.length) return false;
  return (projects || []).some((p) => {
    const cl = p.classes || [];
    return cl.indexOf(classKey) >= 0 && others.some((c) => cl.indexOf(c) >= 0);
  });
}

/** Pure: trimmed + lowercased email, or '' if it isn't email-shaped. */
function normalizeRosterEmail_(raw) {
  const e = String(raw || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : '';
}

/**
 * Pure: which of a project's groups the student must leave when unenrolled from
 * classKey. They stay only while they still share a project class with one of
 * their teammates. Leave when they share no other class with the project, or
 * none of their remaining project classes is a teammate's class. Groups may
 * span periods, so this uses the members' classes (g.memberClassMap), not the
 * folder the group Sheet sits in. A group without a memberClassMap (legacy
 * caller) falls back to its home class.
 */
function groupsToLeaveOnUnenroll_(groups, email, classKey, remainingProjectClasses) {
  const e = String(email || '').toLowerCase();
  const remaining = remainingProjectClasses || [];
  const orphaned = !remaining.length;
  return (groups || []).filter((g) => {
    if (!(g.memberEmails || []).some((m) => String(m).toLowerCase() === e)) return false;
    if (orphaned) return true;
    if (!g.memberClassMap) return g.className === classKey;
    const teammateClasses = {};
    Object.keys(g.memberClassMap).forEach((m) => {
      if (m === e) return;
      (g.memberClassMap[m] || []).forEach((c) => { teammateClasses[c] = true; });
    });
    return !remaining.some((c) => teammateClasses[c]);
  });
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

/** Server-side gate shared by all three endpoints. Returns {actorEmail, cls, isAdmin}. */
function assertCanEditClassRoster_(classKey) {
  const actorEmail = getActorEmail_();
  const staff = assertStaff_(actorEmail);
  const key = String(classKey || '').trim();
  if (!key) throw new Error('class required');
  const cls = getClassRecord_(key);
  if (!cls) throw new Error('No such class: ' + key);
  const isAdmin = isAdmin_(staff);
  if (!canEditClassRoster_(actorEmail, isAdmin, cls)) throw new Error('Class not in your scope');
  return { actorEmail, cls, isAdmin };
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
  if (!a.isAdmin) {
    const studentClasses = getStudentClasses_(em);
    const teacherOf = {};
    studentClasses.forEach((c) => {
      const rec = getClassRecord_(c);
      teacherOf[c] = rec ? String(rec.TeacherEmail || '').toLowerCase() : '';
    });
    const projects = listActiveProjects_().map((p) => ({ classes: projectClassList_(p) }));
    if (enrollConflictsWithOtherTeacher_(a.actorEmail, cls, studentClasses, projects, teacherOf)) {
      return { ok: false, reason: 'other_teacher', message: ROSTER_OTHER_TEACHER_MSG };
    }
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
  const res = leaveClass_(a.actorEmail, em, cls, '');
  return Object.assign(classRosterPayload_(a.cls), { email: em, removed: res.removed, leftGroups: res.leftGroups });
}

/**
 * Take a student out of one class: leave any group they no longer share a
 * section with a teammate in (active projects that include this class), then
 * drop the enrollment row and audit. Sheets are never trashed. `auditNote` is
 * appended to the audit detail (e.g. 'move;to=<class>').
 * Returns { removed, leftGroups:[{projectId, groupId, autoDisbanded}] }.
 */
function leaveClass_(actorEmail, em, cls, auditNote) {
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
        const r = removeMemberFromGroupCore_(project, group, em, actorEmail);
        leftGroups.push({ projectId: project.projectId, groupId: g.groupId, autoDisbanded: !!r.autoDisbanded });
      });
      resetGroupSheetCache_();
    });
  });

  const res = unenroll_(em, cls);
  appendAuditEvent_({
    projectId: '', action: AUDIT_ACTIONS.ROSTER_UNENROLL, actor: actorEmail,
    detail: 'class=' + cls + ';email=' + em + (auditNote ? ';' + auditNote : '') +
      (leftGroups.length ? ';leftGroups=' + leftGroups.map((x) => x.groupId).join(',') : ''),
  });
  return { removed: res.removed, leftGroups };
}

// ============================================================
// Move a student to another period
// ------------------------------------------------------------
// One step instead of add-here + remove-there. Work is stored per (student,
// project) and found by email in any class folder, so nothing moves on disk:
// the student just shows up under the new section. A teacher may move a
// student between sections they teach; admins between any classes.
// ============================================================

/**
 * Pure: names of the projects the student is in now (via any class) that they
 * would drop out of after moving fromClass → toClass. projects =
 * [{ name, classes:[...] }]. Their work in those projects is kept, just hidden
 * until a class in the project is theirs again.
 */
function projectsLostOnMove_(projects, studentClasses, fromClass, toClass) {
  const now = studentClasses || [];
  const after = now.filter((c) => c !== fromClass).concat(now.indexOf(toClass) >= 0 ? [] : [toClass]);
  const hit = (cl, list) => (cl || []).some((c) => list.indexOf(c) >= 0);
  return (projects || [])
    .filter((p) => hit(p.classes, now) && !hit(p.classes, after))
    .map((p) => p.name);
}

/**
 * Pure: the classes a student in fromClass can be moved into, sorted by label.
 * classes = listClasses_() rows; a non-admin only gets classes they teach.
 * Inactive classes, the source class and classes they're already in are left
 * out. Each target carries lostProjects (projectsLostOnMove_).
 */
function moveTargetsFor_(classes, actorEmail, isAdmin, fromClass, studentClasses, projects) {
  const a = String(actorEmail || '').trim().toLowerCase();
  const mine = studentClasses || [];
  return (classes || [])
    .filter((c) => c.Class && c.Class !== fromClass && mine.indexOf(c.Class) < 0)
    .filter((c) => String(c.Status || 'active').toLowerCase() === 'active')
    .filter((c) => isAdmin || String(c.TeacherEmail || '').trim().toLowerCase() === a)
    .map((c) => ({
      classKey: c.Class,
      label: classDisplayLabel_(c),
      lostProjects: projectsLostOnMove_(projects, mine, fromClass, c.Class),
    }))
    .sort((x, y) => x.label.toLowerCase().localeCompare(y.label.toLowerCase()));
}

/** Where can this student be moved? { ok, email, fromLabel, targets:[{classKey,label,lostProjects}] } */
function consoleGetMoveTargets(classKey, email) {
  const a = assertCanEditClassRoster_(classKey);
  const em = String(email || '').trim().toLowerCase();
  if (!em) throw new Error('email required');
  const projects = listActiveProjects_().map((p) => ({ name: p.name, classes: projectClassList_(p) }));
  return {
    ok: true,
    email: em,
    fromLabel: classDisplayLabel_(a.cls),
    targets: moveTargetsFor_(listClasses_(), a.actorEmail, a.isAdmin, a.cls.Class,
      getStudentClasses_(em), projects),
  };
}

/**
 * Move a student from one class to another: enroll in the target, then leave
 * the source (leaveClass_, which keeps them in a group while they still share
 * a section with a teammate). The actor must be able to edit both classes'
 * rosters. Returns the SOURCE class's refreshed roster + { email, toClass,
 * toLabel, leftGroups }.
 */
function consoleMoveStudentToClass(fromClassKey, toClassKey, email) {
  const a = assertCanEditClassRoster_(fromClassKey);
  const b = assertCanEditClassRoster_(toClassKey);
  const em = String(email || '').trim().toLowerCase();
  if (!em) throw new Error('email required');
  const from = a.cls.Class, to = b.cls.Class;
  if (from === to) throw new Error('Pick a different section');
  if (enrollmentsForClass_(from).indexOf(em) < 0) throw new Error(em + ' is not in ' + classDisplayLabel_(a.cls));
  if (!a.isAdmin) {
    // Same guard as Add: don't hand the teacher a student another teacher
    // has in a shared active project. The class being left doesn't count.
    const studentClasses = getStudentClasses_(em).filter((c) => c !== from);
    const teacherOf = {};
    studentClasses.forEach((c) => {
      const rec = getClassRecord_(c);
      teacherOf[c] = rec ? String(rec.TeacherEmail || '').toLowerCase() : '';
    });
    const projects = listActiveProjects_().map((p) => ({ classes: projectClassList_(p) }));
    if (enrollConflictsWithOtherTeacher_(a.actorEmail, to, studentClasses, projects, teacherOf)) {
      return { ok: false, reason: 'other_teacher', message: ROSTER_OTHER_TEACHER_MSG };
    }
  }

  if (enrollmentsForClass_(to).indexOf(em) < 0) {
    enroll_(em, to);
    appendAuditEvent_({
      projectId: '', action: AUDIT_ACTIONS.ROSTER_ENROLL, actor: a.actorEmail,
      detail: 'class=' + to + ';email=' + em + ';move;from=' + from,
    });
  }
  const res = leaveClass_(a.actorEmail, em, from, 'move;to=' + to);
  return Object.assign(classRosterPayload_(a.cls), {
    email: em, toClass: to, toLabel: classDisplayLabel_(b.cls), leftGroups: res.leftGroups,
  });
}
