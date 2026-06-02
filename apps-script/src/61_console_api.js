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
// Dashboard cache TTL (seconds). Short by design — the cache is correctness-
// neutral (the per-student Sheets stay authoritative; stale ≤ TTL), and the
// Refresh button bypasses it. Keeps repeated navigation/refocus instant
// without a write-path invalidation hook.
var DASH_CACHE_TTL_SEC = 45;

/**
 * @param {string} projectId
 * @param {string} [className]   Narrow to a single class (drives the client's
 *                               per-class fan-out). Omit for the actor's full scope.
 * @param {boolean} [bypassCache] Skip the read cache (Refresh button).
 */
function consoleGetProjectDashboard(projectId, className, bypassCache) {
  const actorEmail = getActorEmail_();
  const staff = assertStaff_(actorEmail);
  if (!projectId) throw new Error('projectId required');
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown project ' + projectId);
  const bundle = getBundle_(project.bundleId);
  resetGroupSheetCache_();

  const projectClasses = projectClassList_(project);
  const teacherClasses = isAdmin_(staff) ? null : listClassesTaughtBy_(actorEmail);
  let scopedClasses = isAdmin_(staff)
    ? projectClasses
    : projectClasses.filter((c) => teacherClasses.indexOf(c) >= 0);
  if (className) {
    const cn = String(className).trim();
    scopedClasses = scopedClasses.filter((c) => c === cn);
  }

  // Scope-keyed short-TTL cache. Classes fully determine the data, so two
  // teachers with the same scope share an entry; the actor email is not needed
  // in the key.
  const cache = CacheService.getScriptCache();
  const cacheKey = 'dash:v1:' + projectId + ':' + scopedClasses.slice().sort().join(',');
  if (!bypassCache) {
    const hit = cache.get(cacheKey);
    if (hit) { try { return JSON.parse(hit); } catch (e) { /* corrupt — recompute */ } }
  }

  // Parallel read is the fast path. If it wholesale-fails (e.g. the Sheets API
  // is disabled in the GCP project, or a transient outage), fall back to the
  // serial SpreadsheetApp path so the dashboard is never empty — correct-but-
  // slow beats fast-but-blank. A partial failure (one bad sheet) keeps the
  // parallel result; that sheet just shows zeros and is logged.
  let result;
  try {
    result = computeDashboardParallel_(project, scopedClasses, bundle);
    if (result.readRequested > 0 && result.readErrors >= result.readRequested) {
      console.warn('[OPS] dashboard parallel read fully failed (' + result.readErrors +
        '/' + result.readRequested + ' sheets); falling back to serial.');
      result = computeDashboardSerial_(project, scopedClasses, bundle);
    }
  } catch (e) {
    console.warn('[OPS] dashboard parallel path threw; serial fallback: ' + (e && e.message || e));
    result = computeDashboardSerial_(project, scopedClasses, bundle);
  }
  const students = result.students;
  const groups = result.groups;

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
    groups,
    asOf: nowIso_(),
  };
  if (banner) resp.recentUnarchive = banner;
  // >100KB values (a huge admin 'all' scope) silently fail to cache — caught
  // here so the request still returns; the parallel path is fast regardless.
  try { cache.put(cacheKey, JSON.stringify(resp), DASH_CACHE_TTL_SEC); } catch (e) { /* skip cache */ }
  return resp;
}

/** Enrolled roster rows for a set of classes. */
function dashboardEnrolled_(scopedClasses) {
  const rosterRows = readAllAsObjects_(
    getTab_(SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID), TABS.ROSTER),
    HEADERS.ROSTER
  );
  return rosterRows.filter(
    (r) => r.Class && scopedClasses.indexOf(String(r.Class).trim()) >= 0
  );
}

/**
 * Build the {students, groups} aggregates by reading every Sheet in scope
 * CONCURRENTLY (manifest-resolved ids → batch fetch). This is the production
 * path. `computeDashboardSerial_` below is the byte-for-byte equivalent using
 * sequential SpreadsheetApp opens — kept as the parity baseline
 * (devTestDashboardParityParallelVsSerial) and an emergency fallback.
 */
function computeDashboardParallel_(project, scopedClasses, bundle) {
  const enrolled = dashboardEnrolled_(scopedClasses);

  // Groups in scope — opens each group Sheet once (O(groups)) for membership +
  // tab gids.
  const groupsInProject = listGroupsForProject_(project)
    .filter((g) => scopedClasses.indexOf(g.className) >= 0);
  const emailToGroupSheet = {};   // emailLower → group sheetId
  const groupSheetToId = {};      // group sheetId → groupId
  const descById = {};            // sheetId → { id, sourcesGid, highlightsGid } for the CSV reader
  groupsInProject.forEach((g) => {
    groupSheetToId[g.sheetId] = g.groupId;
    descById[g.sheetId] = { id: g.sheetId, sourcesGid: g.sourcesGid, highlightsGid: g.highlightsGid };
    (g.memberEmails || []).forEach((e) => { emailToGroupSheet[String(e).toLowerCase()] = g.sheetId; });
  });

  // Resolve every enrolled student to a sheetId: group member → group Sheet;
  // else manifest solo entry (id + tab gids); else Drive fallback (+ best-effort
  // manifest backfill so the next load skips the walk). A manifest entry missing
  // its gids is treated as incomplete and re-resolved.
  const manifest = loadProjectManifest_(project.projectId);
  const studentSheetId = {};   // email → sheetId|null
  const studentIsGroup = {};   // email → bool
  enrolled.forEach((r) => {
    const emailLower = String(r.Email).toLowerCase();
    if (emailToGroupSheet[emailLower]) {
      studentSheetId[r.Email] = emailToGroupSheet[emailLower];
      studentIsGroup[r.Email] = true;
      return;
    }
    studentIsGroup[r.Email] = false;
    const entry = manifest[emailLower];
    if (manifestEntryComplete_(entry)) {
      studentSheetId[r.Email] = entry.id;
      descById[entry.id] = { id: entry.id, sourcesGid: entry.sgid, highlightsGid: entry.hgid };
      return;
    }
    // Miss / incomplete entry → resolve via Drive once, backfill the manifest.
    const ss = getSoloSheetIfExists_(r.Email, project);
    if (ss) {
      const id = ss.getId();
      recordSoloSheetForSs_(project.projectId, r.Email, ss);
      studentSheetId[r.Email] = id;
      descById[id] = { id, sourcesGid: tabGid_(ss, TABS.SOURCES), highlightsGid: tabGid_(ss, TABS.HIGHLIGHTS) };
    } else {
      studentSheetId[r.Email] = null;   // student never provisioned a Sheet
    }
  });

  // One parallel CSV-export read across every distinct Sheet (solo + group).
  const descriptors = Object.keys(descById).map((id) => descById[id]);
  const batch = batchReadStudentData_(descriptors);
  if (batch.errors.length) {
    console.warn('[OPS] dashboard batch read: ' + batch.errors.length +
      ' request(s) failed: ' + JSON.stringify(batch.errors.slice(0, 5)));
  }
  const readFor = (sheetId) => (sheetId && batch.data[sheetId]) || { sources: [], highlights: [] };
  const readRequested = descriptors.length;   // unique sheets attempted
  // Count sheets with ANY failed tab as failed, so a wholesale outage (every
  // sheet erroring) is detected for the serial fallback.
  const failedSheetIds = {};
  batch.errors.forEach((e) => { if (e.id) failedSheetIds[e.id] = true; });
  const readErrors = Object.keys(failedSheetIds).length;

  const students = enrolled.map((r) => {
    const fetched = readFor(studentSheetId[r.Email]);
    const isGroup = studentIsGroup[r.Email];
    const personalSources    = isGroup ? fetched.sources.filter((s)    => String(s.createdByEmail).toLowerCase()    === String(r.Email).toLowerCase()) : fetched.sources;
    const personalHighlights = isGroup ? fetched.highlights.filter((h) => String(h.createdByEmail).toLowerCase() === String(r.Email).toLowerCase()) : fetched.highlights;
    const agg = aggregateStudent_(personalSources, personalHighlights, bundle);
    return {
      email: r.Email,
      name:  composeStudentName_(r),
      class: String(r.Class || ''),
      groupId: isGroup ? (groupSheetToId[studentSheetId[r.Email]] || null) : null,
      categoryMix:    agg.categoryMix,
      sourceCount:    agg.sourceCount,
      highlightCount: agg.highlightCount,
      completion:     agg.completion,
      gaps:           agg.gaps,
      lastActivity:   agg.lastActivity,
    };
  });

  const groups = groupsInProject.map((g) => {
    const fetched = readFor(g.sheetId);
    const agg = aggregateStudent_(fetched.sources, fetched.highlights, bundle);
    return {
      groupId: g.groupId,
      name: g.name,
      className: g.className,
      memberEmails: g.memberEmails,
      memberCount: g.memberCount,
      categoryMix:    agg.categoryMix,
      sourceCount:    agg.sourceCount,
      highlightCount: agg.highlightCount,
      completion:     agg.completion,
      gaps:           agg.gaps,
      lastActivity:   agg.lastActivity,
    };
  });

  // readRequested/readErrors let the caller detect a wholesale failure and fall
  // back to the serial path. (The parity test reads only students/groups.)
  return { students, groups, readRequested, readErrors };
}

/**
 * Sequential-read equivalent of computeDashboardParallel_ — the original
 * implementation, preserved verbatim in behavior. Not on the hot path; it
 * exists so devTestDashboardParityParallelVsSerial can assert the parallel
 * path produces identical aggregates, and as a hand-pull fallback.
 */
function computeDashboardSerial_(project, scopedClasses, bundle) {
  const enrolled = dashboardEnrolled_(scopedClasses);

  const sheetCache = {};  // sheetId → { sources, highlights }
  function readForActor_(email) {
    const ss = getStudentSheetIfExists_(email, project);
    if (!ss) return { sources: [], highlights: [], sheetId: null, isGroup: false };
    const sheetId = ss.getId();
    if (!sheetCache[sheetId]) {
      sheetCache[sheetId] = {
        sources:    readAllAsObjects_(getTab_(ss, TABS.SOURCES),    HEADERS.SOURCES),
        highlights: readAllAsObjects_(getTab_(ss, TABS.HIGHLIGHTS), HEADERS.HIGHLIGHTS),
      };
    }
    const meta = readGroupMeta_(ss);
    const isGroup = !!(meta && String(meta.groupId || '').trim());
    return { sources: sheetCache[sheetId].sources, highlights: sheetCache[sheetId].highlights, sheetId, isGroup, meta };
  }

  const students = enrolled.map((r) => {
    const fetched = readForActor_(r.Email);
    const personalSources    = fetched.isGroup ? fetched.sources.filter((s)    => String(s.createdByEmail).toLowerCase()    === String(r.Email).toLowerCase()) : fetched.sources;
    const personalHighlights = fetched.isGroup ? fetched.highlights.filter((h) => String(h.createdByEmail).toLowerCase() === String(r.Email).toLowerCase()) : fetched.highlights;
    const agg = aggregateStudent_(personalSources, personalHighlights, bundle);
    return {
      email: r.Email,
      name:  composeStudentName_(r),
      class: String(r.Class || ''),
      groupId: fetched.isGroup ? fetched.meta.groupId : null,
      categoryMix:    agg.categoryMix,
      sourceCount:    agg.sourceCount,
      highlightCount: agg.highlightCount,
      completion:     agg.completion,
      gaps:           agg.gaps,
      lastActivity:   agg.lastActivity,
    };
  });

  const groupsInProject = listGroupsForProject_(project);
  const groups = groupsInProject
    .filter((g) => scopedClasses.indexOf(g.className) >= 0)
    .map((g) => {
      const ss = SpreadsheetApp.openById(g.sheetId);
      const sheetId = ss.getId();
      if (!sheetCache[sheetId]) {
        sheetCache[sheetId] = {
          sources:    readAllAsObjects_(getTab_(ss, TABS.SOURCES),    HEADERS.SOURCES),
          highlights: readAllAsObjects_(getTab_(ss, TABS.HIGHLIGHTS), HEADERS.HIGHLIGHTS),
        };
      }
      const agg = aggregateStudent_(sheetCache[sheetId].sources, sheetCache[sheetId].highlights, bundle);
      return {
        groupId: g.groupId,
        name: g.name,
        className: g.className,
        memberEmails: g.memberEmails,
        memberCount: g.memberCount,
        categoryMix:    agg.categoryMix,
        sourceCount:    agg.sourceCount,
        highlightCount: agg.highlightCount,
        completion:     agg.completion,
        gaps:           agg.gaps,
        lastActivity:   agg.lastActivity,
      };
    });

  return { students, groups };
}

/**
 * Surface for `google.script.run` to enumerate bundles when populating the
 * Create Project wizard. Staff-gated like the rest of the console.
 *
 * NOTE: name deliberately has NO trailing underscore. GAS treats functions
 * whose names end with `_` as private and refuses to expose them via
 * google.script.run — the client call site would silently get `undefined`.
 */
function listBundlesForConsole() {
  assertStaff_(getActorEmail_());
  return { ok: true, bundles: listBundles_() };
}

/**
 * Update the memberClasses of an existing project. Lets a teacher add
 * students to a project by adding their class to the project's list.
 *
 * Authorization (server-side, defense in depth — UI also gates):
 *  - Staff-only (assertStaff_).
 *  - Teachers: can ONLY add classes they teach AND can ONLY remove classes
 *    they teach. Classes in the project that the teacher doesn't teach are
 *    out of their reach (the other teacher's responsibility).
 *  - Admins: no class restrictions.
 *
 * Accepts the FULL new memberClasses array — server diffs old vs. new to
 * enforce add/remove scoping.
 */
function consoleUpdateProjectClasses(projectId, memberClasses) {
  const actorEmail = getActorEmail_();
  const staff = assertStaff_(actorEmail);
  if (!projectId) throw new Error('projectId required');
  if (!Array.isArray(memberClasses)) throw new Error('memberClasses must be an array');

  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown project ' + projectId);

  const newClasses = memberClasses.map((c) => String(c).trim()).filter(Boolean);
  if (newClasses.length === 0) throw new Error('At least one class required');
  const oldClasses = projectClassList_(project);

  if (!isAdmin_(staff)) {
    const taught = listClassesTaughtBy_(actorEmail);
    const added = newClasses.filter((c) => oldClasses.indexOf(c) < 0);
    const addedOutside = added.filter((c) => taught.indexOf(c) < 0);
    if (addedOutside.length > 0) {
      throw new Error('You cannot add classes you do not teach: ' + addedOutside.join(', '));
    }
    const removed = oldClasses.filter((c) => newClasses.indexOf(c) < 0);
    const removedOutside = removed.filter((c) => taught.indexOf(c) < 0);
    if (removedOutside.length > 0) {
      throw new Error('You cannot remove classes you do not teach: ' + removedOutside.join(', '));
    }
  }

  const ss = SpreadsheetApp.openById(CONFIG.PROJECTS_SHEET_ID);
  const tab = getTab_(ss, TABS.PROJECTS);
  const rowIdx = findRowByKey_(tab, HEADERS.PROJECTS, 'projectId', projectId);
  if (rowIdx < 0) throw new Error('Unknown projectId ' + projectId);
  const col = HEADERS.PROJECTS.indexOf('memberClasses') + 1;
  tab.getRange(rowIdx, col).setValue(newClasses.join(','));

  return { ok: true, projectId, memberClasses: newClasses };
}

/**
 * All distinct Class values from the Roster. Used by the admin Edit-classes
 * modal to populate the full set of options. Teachers' modals scope to their
 * teacherClasses ∪ project's current classes (filtered client-side from the
 * already-known context).
 */
function consoleListAllClasses() {
  assertStaff_(getActorEmail_());
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const rows = readAllAsObjects_(getTab_(ss, TABS.ROSTER), HEADERS.ROSTER);
  const set = {};
  rows.forEach((r) => {
    const cls = String(r.Class || '').trim();
    if (cls) set[cls] = true;
  });
  return { ok: true, classes: Object.keys(set).sort() };
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

  return withGroupLock_(() => {
    // Stage: mint groupId + create the group Sheet.
    const groupId = uuid_();
    const projectFolder = DriveApp.getFolderById(project.rootFolderId);
    const classFolder = findChildFolder_(projectFolder, v.sharedClass) ||
                        projectFolder.createFolder(v.sharedClass);
    const created = createGroupSheet_(project, classFolder, v.trimmedName, groupId, v.rosters);

    // Copy each member's rows into the group, then trash their solo Sheet.
    // ATOMIC: if any member fails, trash the new group Sheet and throw —
    // otherwise the failed member would have writes routed to a group Sheet
    // that never received their existing work (a data-loss surface). The
    // group Sheet is the sole store from here; un-merge reconstructs solos
    // from it by createdByEmail, so there's no archived snapshot to keep.
    let sourcesCopied = 0, highlightsCopied = 0;
    try {
      v.lowered.forEach((email) => {
        // Locate the solo Sheet directly via Drive (don't go through the
        // group routing hook — that would recurse now the group exists).
        const soloFile = findChildFile_(classFolder, email);
        if (!soloFile) {
          // Never highlighted — no rows to migrate. The Members row from
          // createGroupSheet_ already routes their future writes here.
          return;
        }
        const soloSpreadsheet = SpreadsheetApp.openById(soloFile.getId());
        const copied = copyMemberRowsIntoGroup_(created.spreadsheet, soloSpreadsheet);
        sourcesCopied    += copied.sourcesCopied;
        highlightsCopied += copied.highlightsCopied;
        DriveApp.getFileById(soloFile.getId()).setTrashed(true);
        forgetSoloSheetId_(project.projectId, email);   // solo Sheet trashed — drop its dashboard-manifest entry
      });
    } catch (e) {
      // Roll back the group Sheet so future writes don't route here.
      try { DriveApp.getFileById(created.spreadsheet.getId()).setTrashed(true); }
      catch (cleanupErr) { /* best-effort; surface original error below */ }
      resetGroupSheetCache_();
      throw new Error('Failed to create group and migrate members: ' + (e && e.message || e));
    }

    // Audit. Non-fatal — the migration succeeded; a missing audit row is a
    // recoverable nuisance, not data loss.
    const auditErrors = [];
    v.lowered.forEach((email) => {
      try {
        appendAuditEvent_({
          projectId,
          action: AUDIT_ACTIONS.GROUP_MERGE,
          actor:  actorEmail,
          detail: 'groupId=' + groupId + ';memberEmail=' + email,
        });
      } catch (e) {
        auditErrors.push({ email, error: 'audit: ' + String(e && e.message || e) });
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
      errors: auditErrors,
    };
  });
}

/**
 * Move a student from one group to another (same project, same class). The
 * student's work follows them: it is pulled out of `from` (reconstructed,
 * orphan-safe) and copied into `to`. If `from` drops to ≤1 member it
 * auto-disbands. Use consoleAddToGroup to add an ungrouped student.
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
  fromGroup.groupId = fromGroupId;
  toGroup.groupId   = toGroupId;

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
  if (!currentMembers_(fromGroup.spreadsheet).find((m) => String(m.email).toLowerCase() === target)) {
    throw new Error(email + ' is not a current member of the source group');
  }
  if (currentMembers_(toGroup.spreadsheet).find((m) => String(m.email).toLowerCase() === target)) {
    throw new Error(email + ' is already in the target group');
  }
  if (currentMembers_(toGroup.spreadsheet).length >= 4) {
    throw new Error('Target group already has 4 members');
  }

  const roster = getStudentRosterEntry_(email);
  if (!roster) throw new Error('Not on roster: ' + email);

  return withGroupLock_(() => {
    // Pull the student (and their work) out of `from`, then add them (and
    // that work) to `to`. Removing may auto-disband `from` if it drops to
    // ≤1 member.
    removeMemberFromGroupCore_(project, fromGroup, target, actorEmail);
    addMemberToGroupCore_(project, toGroup, roster, actorEmail);
    appendAuditEvent_({
      projectId,
      action: AUDIT_ACTIONS.GROUP_MOVE,
      actor:  actorEmail,
      detail: 'from=' + fromGroupId + ';to=' + toGroupId + ';email=' + target,
    });
    resetGroupSheetCache_();
    return { ok: true, fromGroupId, toGroupId, email: target, errors: [] };
  });
}

/**
 * Disband a group: every current member's solo Sheet is reconstructed from
 * the group's rows (their createdByEmail rows + referential closure), so
 * their group-period work follows them out. The group Sheet is then moved
 * into Archived-students/ for posterity.
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
  group.groupId = groupId;

  if (!isAdmin_(staff)) {
    const taught = listClassesTaughtBy_(actorEmail);
    if (taught.indexOf(group.classFolder.getName()) < 0) {
      throw new Error('Class not in your scope');
    }
  }

  return withGroupLock_(() => {
    const result = disbandGroupCore_(project, group, actorEmail);
    resetGroupSheetCache_();
    return { ok: true, groupId, restoredCount: result.restoredCount, errors: [] };
  });
}

/**
 * Un-merge a single student: reconstruct their solo Sheet from the group
 * (their createdByEmail rows + referential closure) and strip their rows
 * from the group, orphan-safe. If the group would drop to ≤1 member it
 * auto-disbands (a one-person group is just a solo student).
 *
 * Returns { ok, groupId, email, autoDisbanded, errors }.
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
  group.groupId = groupId;

  if (!isAdmin_(staff)) {
    const taught = listClassesTaughtBy_(actorEmail);
    if (taught.indexOf(group.classFolder.getName()) < 0) {
      throw new Error('Class not in your scope');
    }
  }

  const target = String(email).toLowerCase();
  if (!currentMembers_(group.spreadsheet).find((m) => String(m.email).toLowerCase() === target)) {
    throw new Error(email + ' is not a current member of this group');
  }

  return withGroupLock_(() => {
    const result = removeMemberFromGroupCore_(project, group, target, actorEmail);
    resetGroupSheetCache_();
    return { ok: true, groupId, email: target, autoDisbanded: !!result.autoDisbanded, errors: [] };
  });
}

/**
 * Add an ungrouped, same-class student to an existing active group: their
 * solo work is copied in and the solo Sheet trashed. Use
 * consoleGroupMoveStudent to relocate an already-grouped student.
 *
 * Returns { ok, groupId, email, copiedSources, copiedHighlights, errors }.
 */
function consoleAddToGroup(projectId, groupId, email) {
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
  group.groupId = groupId;

  const roster = getStudentRosterEntry_(email);
  if (!roster) throw new Error('Not on roster: ' + email);
  if (String(roster.Class || '').trim() !== group.classFolder.getName()) {
    throw new Error('Member must be in class ' + group.classFolder.getName());
  }
  if (!isAdmin_(staff)) {
    const taught = listClassesTaughtBy_(actorEmail);
    if (taught.indexOf(group.classFolder.getName()) < 0) {
      throw new Error('Class not in your scope');
    }
  }
  const target = String(email).toLowerCase();
  if (findGroupSheetForStudent_(target, project)) {
    throw new Error(email + ' is already in a group — move them instead');
  }
  if (currentMembers_(group.spreadsheet).length >= 4) {
    throw new Error('Group already has 4 members');
  }

  return withGroupLock_(() => {
    const result = addMemberToGroupCore_(project, group, roster, actorEmail);
    resetGroupSheetCache_();
    return {
      ok: true, groupId, email: target,
      copiedSources: result.copiedSources, copiedHighlights: result.copiedHighlights,
      errors: [],
    };
  });
}

/**
 * Walk a project and report group/solo drift. Admin-only; no client UI —
 * exposed for manual recovery via the GAS editor.
 *
 * Authoritative membership lives in each group's Members tab, so drift is
 * detected by cross-referencing current members against live solo Sheets —
 * NOT via solo `Meta.groupId` (no longer stamped; merge trashes solos and
 * un-merge reconstructs them with an empty groupId).
 *
 * Returns { ok, issues: [{kind, ...}] }:
 *   - kind 'group_member_solo_sheet_present':
 *       a current group member also has a live solo Sheet at class root
 *       (merge/add should have trashed it) — usually a half-applied add/move.
 *   - kind 'orphan_meta_groupId':
 *       a solo Sheet's Meta.groupId points to a non-existent group (legacy).
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
  const memberToGroup = {};  // lowercased email → groupId (current members of active groups)
  groups.forEach((g) => {
    groupIds[g.groupId] = g;
    (g.memberEmails || []).forEach((m) => { memberToGroup[String(m).toLowerCase()] = g.groupId; });
  });

  // Walk every class folder.
  const projectFolder = DriveApp.getFolderById(project.rootFolderId);
  const classFolders = projectFolder.getFolders();
  while (classFolders.hasNext()) {
    const cf = classFolders.next();
    if (cf.getName() === NAMES.ARCHIVED_FOLDER) continue;

    const files = cf.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      if (f.isTrashed()) continue;  // a trashed solo is gone — not drift
      const name = f.getName();
      if (name.indexOf(NAMES.GROUP_SHEET_PREFIX) === 0) continue;  // group Sheets handled separately
      if (name.indexOf('@') < 0) continue;

      // A current group member should have NO live solo Sheet at class root.
      const gid = memberToGroup[name.toLowerCase()];
      if (gid) {
        issues.push({
          kind: 'group_member_solo_sheet_present',
          email: name,
          className: cf.getName(),
          groupId: gid,
        });
      }

      // Legacy back-pointer drift: a solo whose Meta.groupId names a dead group.
      try {
        const meta = readGroupMeta_(SpreadsheetApp.openById(f.getId()));
        const metaGid = meta && String(meta.groupId || '').trim();
        if (metaGid && !groupIds[metaGid]) {
          issues.push({
            kind: 'orphan_meta_groupId',
            email: name,
            className: cf.getName(),
            groupIdPointer: metaGid,
          });
        }
      } catch (e) { /* not a Sheet, skip */ }
    }
  }

  return { ok: true, issues };
}

/**
 * Group-aggregate drill-down. Same response shape as
 * consoleGetStudentDetail but the inputs are the group's FULL
 * unfiltered Sources + Highlights, and the response carries member
 * attribution on each highlight so the teacher can see who wrote what.
 */
function consoleGetGroupDashboard(projectId, groupId) {
  const actorEmail = getActorEmail_();
  const staff = assertStaff_(actorEmail);
  if (!projectId) throw new Error('projectId required');
  if (!groupId)   throw new Error('groupId required');
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown project ' + projectId);
  const bundle = getBundle_(project.bundleId);
  resetGroupSheetCache_();

  const located = findGroupFileByGroupId_(project, groupId);
  if (!located) throw new Error('Group not found: ' + groupId);

  if (!isAdmin_(staff)) {
    const taught = listClassesTaughtBy_(actorEmail);
    if (taught.indexOf(located.classFolder.getName()) < 0) {
      throw new Error('Class not in your scope');
    }
  }

  const ss = located.spreadsheet;
  const sources    = readAllAsObjects_(getTab_(ss, TABS.SOURCES),    HEADERS.SOURCES);
  const highlights = readAllAsObjects_(getTab_(ss, TABS.HIGHLIGHTS), HEADERS.HIGHLIGHTS);
  const members    = currentMembers_(ss);
  const meta       = readGroupMeta_(ss);

  // Reuse the student-detail enrichment so the viewer renders identically.
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
      // attributedAuthor: created on the source, useful for the viewer header.
      createdByEmail: s.createdByEmail || '',
      highlights: highlights
        .filter((h) => h.sourceId === s.sourceId)
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
        .map((h) => ({
          highlightId: h.highlightId,
          primaryCategory: h.primaryCategory,
          secondaryCategory: h.secondaryCategory,
          highlightedText: h.highlightedText,
          note: h.note || '',
          createdByEmail: h.createdByEmail || '',
          createdAt: h.createdAt,
        })),
      createdAt: s.createdAt,
    };
  });
  enriched.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  const aggregates = aggregateStudentDetail_(sources, highlights, bundle, project.createdAt);

  return {
    ok: true,
    group: {
      groupId,
      name: meta ? meta.studentName : '',
      className: located.classFolder.getName(),
      memberEmails: members.map((m) => m.email),
      memberCount: members.length,
    },
    aggregates,
    sources: enriched,
    asOf: nowIso_(),
  };
}
