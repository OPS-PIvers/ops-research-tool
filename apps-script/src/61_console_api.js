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
 * Compose a display name from roster Last + First, falling back to email
 * when both name fields are blank. Matches the 7-col roster schema.
 * @param {Object} rosterRow - object with Last, First, Email properties
 * @returns {string}
 */
function composeStudentName_(rosterRow) {
  const composed = (String(rosterRow.Last || '') + ', ' + String(rosterRow.First || '')).replace(/^, |, $/g, '');
  return composed || String(rosterRow.Email || '');
}

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
 * Classes whose TeacherEmail column equals this email in the Roster.
 * Distinct, trimmed, non-empty. Returns [] if the actor teaches nothing.
 */
function listClassesTaughtBy_(actorEmail) {
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const rows = readAllAsObjects_(getTab_(ss, TABS.ROSTER), HEADERS.ROSTER);
  const set = {};
  rows.forEach((r) => {
    if (r.TeacherEmail && String(r.TeacherEmail).trim().toLowerCase() === actorEmail.toLowerCase()) {
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

/**
 * Create a project from the Console wizard. Server validates inputs and
 * calls the existing createProject_ helper, which provisions the project
 * folder. Returns the new project record (same shape as
 * consoleGetMyProjects but for a single project).
 */
function consoleCreateProject(args) {
  const actorEmail = getActorEmail_();
  const staff = assertStaff_(actorEmail);
  if (!args) throw new Error('args required');
  const name = String(args.name || '').trim();
  const schoolYear = String(args.schoolYear || '').trim();
  const bundleId = String(args.bundleId || '').trim();
  const memberClasses = Array.isArray(args.memberClasses)
    ? args.memberClasses.map((s) => String(s).trim()).filter(Boolean)
    : [];

  if (!name || name.length > 80)                  throw new Error('Name must be 1–80 characters');
  if (!schoolYear)                                throw new Error('School year required');
  if (!bundleId)                                  throw new Error('Bundle required');
  if (!getBundle_(bundleId))                      throw new Error('Unknown bundle');
  if (memberClasses.length === 0)                 throw new Error('At least one class required');

  // Teachers can only assign classes they themselves teach.
  if (!isAdmin_(staff)) {
    const taught = listClassesTaughtBy_(actorEmail);
    const outside = memberClasses.filter((c) => taught.indexOf(c) < 0);
    if (outside.length > 0) {
      throw new Error('You cannot assign classes you do not teach: ' + outside.join(', '));
    }
  }

  const project = createProject_({
    name, schoolYear, bundleId, memberClasses,
    createdBy: actorEmail,
  });

  // Return a shape compatible with consoleGetMyProjects entries (sans the
  // computed studentCount — the client refetches the list anyway).
  const bundle = getBundle_(bundleId);
  return {
    ok: true,
    project: {
      projectId: project.projectId,
      name: project.name,
      schoolYear: project.schoolYear,
      bundleId: project.bundleId,
      bundleName: bundle.name,
      memberClasses,
      scopedClasses: memberClasses,
      studentCount: 0,    // client will refetch for accurate counts
      status: project.status,
    },
  };
}

/**
 * Flip a project's status to archived, move its Drive folder under
 * Archived/, clear any stale activeProjectId prefs, and write an audit
 * event. Anyone on staff can archive any project (authorization is by
 * staff role, not project ownership — both admins and teachers).
 */
function consoleArchiveProject(projectId) {
  const actorEmail = getActorEmail_();
  assertStaff_(actorEmail);
  if (!projectId) throw new Error('projectId required');
  const result = archiveProjectFully_(projectId, AUDIT_ACTIONS.ARCHIVE, actorEmail, '');
  return { ok: true, projectId, errors: result.errors };
}

function consoleUnarchiveProject(projectId) {
  const actorEmail = getActorEmail_();
  assertStaff_(actorEmail);
  if (!projectId) throw new Error('projectId required');
  const result = unarchiveProjectFully_(projectId, actorEmail, '');
  return { ok: true, projectId, errors: result.errors };
}

/**
 * Per-project dashboard data. Returns precomputed aggregates per student
 * (no raw highlight/source data crosses the wire for the dashboard).
 *
 * Teacher: only sees students whose Class ∈ classes they teach AND ∈
 * project.memberClasses. Admin: sees all students in the project.
 */
function consoleGetProjectDashboard(projectId) {
  const actorEmail = getActorEmail_();
  const staff = assertStaff_(actorEmail);
  if (!projectId) throw new Error('projectId required');
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown project ' + projectId);
  const bundle = getBundle_(project.bundleId);

  const projectClasses = projectClassList_(project);
  const teacherClasses = isAdmin_(staff) ? null : listClassesTaughtBy_(actorEmail);
  const scopedClasses = isAdmin_(staff)
    ? projectClasses
    : projectClasses.filter((c) => teacherClasses.indexOf(c) >= 0);

  const rosterRows = readAllAsObjects_(
    getTab_(SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID), TABS.ROSTER),
    HEADERS.ROSTER
  );
  const enrolled = rosterRows.filter(
    (r) => r.Class && scopedClasses.indexOf(String(r.Class).trim()) >= 0
  );

  const students = enrolled.map((r) => {
    const sources = readSourcesForActor_(r.Email, projectId);
    const highlights = readHighlightsForActor_(r.Email, projectId);
    const agg = aggregateStudent_(sources, highlights, bundle);
    return {
      email: r.Email,
      name: composeStudentName_(r),
      class: String(r.Class || ''),
      categoryMix: agg.categoryMix,
      sourceCount: agg.sourceCount,
      highlightCount: agg.highlightCount,
      completion: agg.completion,
      gaps: agg.gaps,
      lastActivity: agg.lastActivity,
    };
  });

  const unarchive = latestUnarchiveFor_(project.projectId);
  const banner = (function () {
    if (!unarchive) return undefined;
    const ageMs = Date.now() - new Date(unarchive.at).getTime();
    if (ageMs < 0 || ageMs > 7 * 24 * 3600 * 1000) return undefined;
    return { eventId: unarchive.eventId, actor: unarchive.actor, at: unarchive.at };
  })();

  const resp = {
    ok: true,
    project: {
      projectId: project.projectId,
      name: project.name,
      schoolYear: project.schoolYear,
      bundleName: bundle ? bundle.name : '',
      memberClasses: projectClasses,
      scopedClasses,
    },
    students,
    asOf: nowIso_(),
  };
  if (banner) resp.recentUnarchive = banner;
  return resp;
}

/**
 * Surface for `google.script.run` to enumerate bundles when populating the
 * Create Project wizard. Staff-gated like the rest of the console.
 */
function listBundlesForConsole_() {
  assertStaff_(getActorEmail_());
  return { ok: true, bundles: listBundles_() };
}

/**
 * Per-student detail for the drill-down. Includes the full aggregate set
 * (with activity-by-day), plus the student's sources with precomputed
 * formattedCitation and highlights[] embedded per source.
 *
 * Class-scope check: teachers can only fetch detail for students in
 * classes they teach. Admins can fetch any student in the project.
 */
function consoleGetStudentDetail(projectId, studentEmail) {
  const actorEmail = getActorEmail_();
  const staff = assertStaff_(actorEmail);
  if (!projectId)    throw new Error('projectId required');
  if (!studentEmail) throw new Error('studentEmail required');
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown project ' + projectId);
  const bundle = getBundle_(project.bundleId);

  // Class-scope check.
  const rosterEntry = getStudentRosterEntry_(studentEmail);
  if (!rosterEntry) throw new Error('Student not on roster: ' + studentEmail);
  const studentClass = String(rosterEntry.Class || '').trim();
  if (!isAdmin_(staff)) {
    const teacherClasses = listClassesTaughtBy_(actorEmail);
    if (teacherClasses.indexOf(studentClass) < 0) {
      throw new Error('Not authorized for student ' + studentEmail);
    }
  }
  if (projectClassList_(project).indexOf(studentClass) < 0) {
    throw new Error('Student class not enrolled in this project');
  }

  const sources = readSourcesForActor_(studentEmail, projectId);
  const highlights = readHighlightsForActor_(studentEmail, projectId);

  // Enrich each source: parsed citationFields, formattedCitation, completion flags,
  // and embedded highlights array filtered to that source.
  const enriched = sources.map((s) => {
    const parsed = parseCitationFields_(s);
    const formatted = formatCitation(
      Object.assign({}, parsed, {
        sourceType: parsed.sourceType || s.sourceType || 'website',
        title:      parsed.title      || s.scrapedTitle  || '',
        siteName:   parsed.siteName   || s.scrapedSite   || '',
        author:     parsed.author     || s.scrapedAuthor || '',
        publishedDate: parsed.publishedDate || s.scrapedDate || '',
        url:        parsed.url        || s.rawUrl || '',
        accessDate: s.accessDate || parsed.accessDate || '',
      }),
      bundle ? bundle.style : 'mla'
    );
    return {
      sourceId: s.sourceId,
      scrapedTitle: s.scrapedTitle,
      citationFieldsParsed: parsed,
      primarySecondary: s.primarySecondary || 'unset',
      annotation: s.annotation || '',
      formattedCitation: formatted,
      completionFlags: {
        citation:       !!(parsed.title && parsed.url),
        classification: s.primarySecondary && s.primarySecondary !== 'unset',
        annotation:     !!(s.annotation && String(s.annotation).trim().length > 0),
      },
      highlights: highlights
        .filter((h) => h.sourceId === s.sourceId)
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')),
      createdAt: s.createdAt,
    };
  });

  // Sort sources by createdAt desc (newest first) for the viewer.
  enriched.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  const aggregates = aggregateStudentDetail_(sources, highlights, bundle, project.createdAt);

  return {
    ok: true,
    student: {
      email: studentEmail,
      name: composeStudentName_(rosterEntry),
      class: studentClass,
    },
    aggregates,
    sources: enriched,
    asOf: nowIso_(),
  };
}

// ============================================================
// Groups (Phase 4 sub-project D)
// ============================================================

/**
 * List active groups in a project, scoped to the caller's classes.
 * Teachers see groups in classes they teach; admins see all.
 *
 * Used by:
 *   - The dashboard to build the "Move to ▾" dropdown.
 *   - Manage Groups mode to map (studentEmail) → membership.
 */
function consoleListGroupsForProject(projectId) {
  const actorEmail = getActorEmail_();
  const staff = assertStaff_(actorEmail);
  if (!projectId) throw new Error('projectId required');
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown project ' + projectId);
  resetGroupSheetCache_();

  let groups = listGroupsForProject_(project);
  if (!isAdmin_(staff)) {
    const taught = listClassesTaughtBy_(actorEmail);
    groups = groups.filter((g) => taught.indexOf(g.className) >= 0);
  }
  return { ok: true, groups };
}

/**
 * Create a group containing the listed members and migrate their existing
 * sources + highlights into the new group Sheet.
 *
 * Atomic order (spec §7.1):
 *   1. Validate inputs + preconditions (validateGroupCreate_).
 *   2. Mint groupId; create group Sheet + tabs + Meta + Members.
 *   3. For each member: copy rows from solo Sheet → group Sheet, stamp
 *      Meta.groupId on the solo Sheet, move it to Archived-students/.
 *   4. Audit one row per member.
 *
 * Returns { ok, groupId, groupSheetId, name, classFolder,
 *           sourcesCopied, highlightsCopied, errors }.
 */
function consoleGroupCreate(projectId, name, memberEmails) {
  const actorEmail = getActorEmail_();
  const staff = assertStaff_(actorEmail);
  if (!projectId) throw new Error('projectId required');
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown project ' + projectId);
  resetGroupSheetCache_();

  const v = validateGroupCreate_(project, name, memberEmails);

  // Teacher scope: must teach the shared class.
  if (!isAdmin_(staff)) {
    const taught = listClassesTaughtBy_(actorEmail);
    if (taught.indexOf(v.sharedClass) < 0) {
      throw new Error('Class not in your scope');
    }
  }

  // Step 1: stage. Mint groupId + create group Sheet.
  const groupId = uuid_();
  const projectFolder = DriveApp.getFolderById(project.rootFolderId);
  const classFolder = findChildFolder_(projectFolder, v.sharedClass) ||
                      projectFolder.createFolder(v.sharedClass);
  const created = createGroupSheet_(project, classFolder, v.trimmedName, groupId, v.rosters);

  // Step 2 + 3: per-member copy + flip + move.
  const errors = [];
  let sourcesCopied = 0, highlightsCopied = 0;
  v.lowered.forEach((email, idx) => {
    try {
      const roster = v.rosters[idx];
      // Locate the solo Sheet directly via Drive (don't go through the
      // group routing hook — that would create an infinite recursion now
      // that the group Sheet exists).
      const soloFile = findChildFile_(classFolder, email);
      if (!soloFile) {
        // Student never highlighted — no rows to migrate. The member
        // entry is already in the group's Members tab from
        // createGroupSheet_, so future writes route correctly.
        return;
      }
      const soloSpreadsheet = SpreadsheetApp.openById(soloFile.getId());
      const copied = copyMemberRowsIntoGroup_(created.spreadsheet, soloSpreadsheet);
      sourcesCopied   += copied.sourcesCopied;
      highlightsCopied += copied.highlightsCopied;
      setSoloMetaGroupId_(soloSpreadsheet, groupId);
      archiveStudentSheetForGroup_(soloFile, classFolder);
    } catch (e) {
      errors.push({ email, error: String(e && e.message || e) });
    }
  });

  // Step 4: audit.
  v.lowered.forEach((email) => {
    try {
      appendAuditEvent_({
        projectId,
        action: AUDIT_ACTIONS.GROUP_MERGE,
        actor:  actorEmail,
        detail: 'groupId=' + groupId + ';memberEmail=' + email,
      });
    } catch (e) {
      errors.push({ email, error: 'audit: ' + String(e && e.message || e) });
    }
  });

  // Bust the cache — subsequent reads must see the new routing.
  resetGroupSheetCache_();

  return {
    ok: true,
    groupId,
    groupSheetId: created.spreadsheet.getId(),
    name: v.trimmedName,
    className: v.sharedClass,
    sourcesCopied,
    highlightsCopied,
    errors,
  };
}

/**
 * Move a student from one group to another (same project, same class).
 * Per spec §7.2: the student's prior work stays in `from`. Only the
 * membership rows change. The Meta.groupId pointer on the archived solo
 * Sheet (if any) is updated to point at the new group so a future
 * un-merge restores correctly.
 *
 * Returns { ok, fromGroupId, toGroupId, email, errors }.
 */
function consoleGroupMoveStudent(projectId, email, fromGroupId, toGroupId) {
  const actorEmail = getActorEmail_();
  const staff = assertStaff_(actorEmail);
  if (!projectId) throw new Error('projectId required');
  if (!email)     throw new Error('email required');
  if (!fromGroupId) throw new Error('fromGroupId required');
  if (!toGroupId)   throw new Error('toGroupId required');
  if (fromGroupId === toGroupId) throw new Error('Source and target groups are the same');
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown project ' + projectId);
  resetGroupSheetCache_();

  const fromGroup = findGroupFileByGroupId_(project, fromGroupId);
  const toGroup   = findGroupFileByGroupId_(project, toGroupId);
  if (!fromGroup) throw new Error('From group not found: ' + fromGroupId);
  if (!toGroup)   throw new Error('To group not found: '   + toGroupId);

  // Same-class invariant.
  if (fromGroup.classFolder.getId() !== toGroup.classFolder.getId()) {
    throw new Error('Cannot move across classes');
  }

  // Teacher scope.
  if (!isAdmin_(staff)) {
    const taught = listClassesTaughtBy_(actorEmail);
    if (taught.indexOf(fromGroup.classFolder.getName()) < 0) {
      throw new Error('Class not in your scope');
    }
  }

  const target = String(email).toLowerCase();
  // Member must currently be in `from`.
  const fromMembers = currentMembers_(fromGroup.spreadsheet);
  if (!fromMembers.find((m) => String(m.email).toLowerCase() === target)) {
    throw new Error(email + ' is not a current member of the source group');
  }
  // Must not already be in `to`.
  const toMembers = currentMembers_(toGroup.spreadsheet);
  if (toMembers.find((m) => String(m.email).toLowerCase() === target)) {
    throw new Error(email + ' is already in the target group');
  }

  const roster = getStudentRosterEntry_(email);
  if (!roster) throw new Error('Not on roster: ' + email);

  // Apply: stamp leftAt on `from`, append member on `to`.
  markMemberLeftAt_(fromGroup.spreadsheet, target);
  appendMemberToGroup_(toGroup.spreadsheet, roster);

  // If the student's archived solo Sheet still exists (from the merge
  // into `from`), update its Meta.groupId to the new group's id so a
  // future un-merge restores cleanly.
  try {
    const archived = findChildFolder_(fromGroup.classFolder, NAMES.ARCHIVED_STUDENTS_FOLDER);
    if (archived) {
      const soloFile = findChildFile_(archived, target);
      if (soloFile) {
        setSoloMetaGroupId_(SpreadsheetApp.openById(soloFile.getId()), toGroupId);
      }
    }
  } catch (e) { /* tolerate; un-merge will inspect Members tab as fallback */ }

  // Audit.
  appendAuditEvent_({
    projectId,
    action: AUDIT_ACTIONS.GROUP_MOVE,
    actor:  actorEmail,
    detail: 'from=' + fromGroupId + ';to=' + toGroupId + ';email=' + target,
  });

  resetGroupSheetCache_();
  return { ok: true, fromGroupId, toGroupId, email: target, errors: [] };
}

/**
 * Disband a group: every current member's solo Sheet is restored from
 * Archived-students/ (Meta.groupId cleared), and the group Sheet is
 * itself moved into Archived-students/ for posterity.
 *
 * Group-period work stays in the (now-archived) group Sheet — spec §7.3.
 *
 * Returns { ok, groupId, restoredCount, errors }.
 */
function consoleGroupDisband(projectId, groupId) {
  const actorEmail = getActorEmail_();
  const staff = assertStaff_(actorEmail);
  if (!projectId) throw new Error('projectId required');
  if (!groupId)   throw new Error('groupId required');
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown project ' + projectId);
  resetGroupSheetCache_();

  const group = findGroupFileByGroupId_(project, groupId);
  if (!group) throw new Error('Group not found: ' + groupId);

  if (!isAdmin_(staff)) {
    const taught = listClassesTaughtBy_(actorEmail);
    if (taught.indexOf(group.classFolder.getName()) < 0) {
      throw new Error('Class not in your scope');
    }
  }

  const members = currentMembers_(group.spreadsheet);
  const errors = [];
  let restoredCount = 0;
  members.forEach((m) => {
    try {
      const file = restoreStudentSheetFromArchive_(m.email, project);
      if (file) restoredCount++;
      markMemberLeftAt_(group.spreadsheet, m.email);
      appendAuditEvent_({
        projectId,
        action: AUDIT_ACTIONS.GROUP_DISBAND,
        actor:  actorEmail,
        detail: 'groupId=' + groupId + ';email=' + m.email,
      });
    } catch (e) {
      errors.push({ email: m.email, error: String(e && e.message || e) });
    }
  });

  // Move the group Sheet itself into Archived-students/.
  try {
    archiveGroupSheet_(group.file, group.classFolder);
  } catch (e) {
    errors.push({ step: 'archiveGroupSheet', error: String(e && e.message || e) });
  }
  try {
    appendAuditEvent_({
      projectId,
      action: AUDIT_ACTIONS.GROUP_DISBAND_GROUP,
      actor:  actorEmail,
      detail: 'groupId=' + groupId,
    });
  } catch (e) {
    errors.push({ step: 'audit', error: String(e && e.message || e) });
  }

  resetGroupSheetCache_();
  return { ok: true, groupId, restoredCount, errors };
}

/**
 * Un-merge a single student from a group of ≥3 members (cannot drop a
 * 2-member group below 2 — use disband instead). Per spec §7.4.
 *
 * Returns { ok, groupId, email, errors }.
 */
function consoleGroupRemoveStudent(projectId, groupId, email) {
  const actorEmail = getActorEmail_();
  const staff = assertStaff_(actorEmail);
  if (!projectId) throw new Error('projectId required');
  if (!groupId)   throw new Error('groupId required');
  if (!email)     throw new Error('email required');
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown project ' + projectId);
  resetGroupSheetCache_();

  const group = findGroupFileByGroupId_(project, groupId);
  if (!group) throw new Error('Group not found: ' + groupId);

  if (!isAdmin_(staff)) {
    const taught = listClassesTaughtBy_(actorEmail);
    if (taught.indexOf(group.classFolder.getName()) < 0) {
      throw new Error('Class not in your scope');
    }
  }

  const target = String(email).toLowerCase();
  const members = currentMembers_(group.spreadsheet);
  if (!members.find((m) => String(m.email).toLowerCase() === target)) {
    throw new Error(email + ' is not a current member of this group');
  }
  if (members.length <= 2) {
    throw new Error('Group must have ≥ 2 members. Use disband instead.');
  }

  // Restore the solo Sheet (or no-op if absent), mark leftAt, audit.
  restoreStudentSheetFromArchive_(target, project);
  markMemberLeftAt_(group.spreadsheet, target);
  appendAuditEvent_({
    projectId,
    action: AUDIT_ACTIONS.GROUP_UNMERGE,
    actor:  actorEmail,
    detail: 'groupId=' + groupId + ';email=' + target,
  });

  resetGroupSheetCache_();
  return { ok: true, groupId, email: target, errors: [] };
}

/**
 * Walk a project and report any group/solo drift. Admin-only; no client
 * UI in this sub-project — exposed for manual recovery via GAS editor.
 *
 * Returns { ok, issues: [{kind, ...}] }:
 *   - kind 'group_member_solo_sheet_present':
 *       a current member's solo Sheet exists outside Archived-students/
 *   - kind 'orphan_meta_groupId':
 *       a solo Sheet's Meta.groupId points to a non-existent group
 */
function consoleGroupCheckIntegrity(projectId) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!projectId) throw new Error('projectId required');
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown project ' + projectId);

  const issues = [];
  const groups = listGroupsForProject_(project);
  const groupIds = {};
  groups.forEach((g) => { groupIds[g.groupId] = g; });

  // Walk every class folder.
  const projectFolder = DriveApp.getFolderById(project.rootFolderId);
  const classFolders = projectFolder.getFolders();
  while (classFolders.hasNext()) {
    const cf = classFolders.next();
    if (cf.getName() === NAMES.ARCHIVED_FOLDER) continue;

    const files = cf.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      const name = f.getName();
      if (name.indexOf(NAMES.GROUP_SHEET_PREFIX) === 0) continue;  // group Sheets handled separately
      if (name.indexOf('@') < 0) continue;
      // Solo Sheet at class folder root — check Meta.groupId.
      try {
        const ss = SpreadsheetApp.openById(f.getId());
        const meta = readGroupMeta_(ss);
        const gid = meta && String(meta.groupId || '').trim();
        if (gid && !groupIds[gid]) {
          issues.push({
            kind: 'orphan_meta_groupId',
            email: name,
            className: cf.getName(),
            groupIdPointer: gid,
          });
        }
        if (gid && groupIds[gid]) {
          // Solo Sheet is at class root but Meta says it's grouped — should be archived.
          issues.push({
            kind: 'group_member_solo_sheet_present',
            email: name,
            className: cf.getName(),
            groupId: gid,
          });
        }
      } catch (e) { /* not a Sheet, skip */ }
    }
  }

  return { ok: true, issues };
}
