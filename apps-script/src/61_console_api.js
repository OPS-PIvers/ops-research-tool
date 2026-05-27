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
 * Flip a project's status to archived. Anyone on staff can archive any
 * project. (Authorization is by staff role, not project ownership, per the
 * Phase 4 spec — admins and teachers both can archive.)
 */
function consoleArchiveProject(projectId) {
  getActorEmail_();   // not used but ensures we throw if no session
  assertStaff_(getActorEmail_());
  if (!projectId) throw new Error('projectId required');
  if (!getProject_(projectId)) throw new Error('Unknown project ' + projectId);
  archiveProject_(projectId);
  return { ok: true, projectId };
}

function consoleUnarchiveProject(projectId) {
  assertStaff_(getActorEmail_());
  if (!projectId) throw new Error('projectId required');
  if (!getProject_(projectId)) throw new Error('Unknown project ' + projectId);
  unarchiveProject_(projectId);
  return { ok: true, projectId };
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

  return {
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
