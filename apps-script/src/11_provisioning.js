/**
 * Lazy provisioning of per-(student, project) Sheets.
 *
 * Layout (per build plan §3):
 *   [Project Root Folder]
 *     [Class folder]
 *       [project] — Research — [student-email] Sheet  (tabs: Meta, Sources, Highlights)
 *
 * The file name carries the student email as its trailing token — that token,
 * not the whole name, is the stable lookup key (see soloSheetName_ /
 * soloSheetNameMatches_). The "[project] — Research —" prefix is purely so the
 * file reads sensibly in Drive; a bare-email name told the student nothing.
 *
 * Phase 1 implements the SOLO path. Group routing is a Phase 4 add-on:
 *   if a (project, student) is in a group, route to the group Sheet instead.
 */

/** Find or create the project's root folder under the global root. */
function findOrCreateProjectFolder_(projectName) {
  const root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);
  return findChildFolder_(root, projectName) || root.createFolder(projectName);
}

/** Find or create a class folder under a project's root folder. */
function findOrCreateClassFolder_(projectFolder, className) {
  return findChildFolder_(projectFolder, className) || projectFolder.createFolder(className);
}

/**
 * Canonical Drive file name for a solo per-(student, project) Sheet:
 *   "<project> — Research — <student-email>"
 * The email is the trailing token because it is the stable lookup key (sheets
 * are matched by it across provisioning, reads, and the admin Drive walk); the
 * project + "Research" prefix only makes the file legible in Drive.
 */
function soloSheetName_(projectName, actorEmail) {
  return String(projectName || '').trim() + ' — Research — ' + String(actorEmail).toLowerCase();
}

/**
 * True iff `fileName` names the solo Sheet for `email`. Matches BOTH the legacy
 * bare-email name and the "<project> — Research — <email>" name. The email must
 * be the whole name, or sit at the very end preceded by a space, so a longer
 * local part (e.g. "bob.jo@x" vs "jo@x") can never false-match.
 */
function soloSheetNameMatches_(fileName, email) {
  const n = String(fileName).toLowerCase();
  const e = String(email).toLowerCase();
  if (n === e) return true;
  return n.length > e.length && n.endsWith(e) && n.charAt(n.length - e.length - 1) === ' ';
}

/**
 * Find a (student, project) solo Sheet file by email, name-format-agnostic.
 * Skips trashed files (a solo Sheet absorbed into a group is trashed, not
 * deleted) — see findChildFile_.
 */
function findSoloSheetFile_(classFolder, actorEmail) {
  const it = classFolder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (!f.isTrashed() && soloSheetNameMatches_(f.getName(), actorEmail)) return f;
  }
  return null;
}

/**
 * Resolve the Sheet a (student, project) writes to. Current members of an
 * active group route to the shared group Sheet; everyone else gets their
 * per-student Sheet. The group hook is the single chokepoint that re-points
 * doPost, the sidebar, and source-dedup at once.
 */
function findOrCreateStudentSheet_(actorEmail, project) {
  const groupSheet = findGroupSheetForStudent_(actorEmail, project);
  if (groupSheet) return groupSheet;
  return findOrCreateSoloSheet_(actorEmail, project);
}

/**
 * The class folder a student's (project) Sheet should live in: the first
 * (sorted, stable) class the student shares with the project. Multi-class aware
 * — a student in classes [A,B] writing to a project covering [B,C] is filed
 * under B, not their arbitrary "first" class. Falls back to the student's first
 * class if there's no overlap (defensive — an eligible student always overlaps),
 * and to '' if the student has no enrollments at all.
 */
function resolveProjectClassForStudent_(actorEmail, project) {
  const studentClasses = getStudentClasses_(actorEmail);
  if (studentClasses.length === 0) return '';
  const projectClasses = projectClassList_(project);
  const shared = studentClasses.filter((c) => projectClasses.indexOf(c) >= 0).sort();
  return shared.length ? shared[0] : studentClasses.slice().sort()[0];
}

/**
 * Find a student's solo Sheet ANYWHERE in the project — manifest first (one
 * openById), else a walk of every non-archived class folder for the email.
 * Class-agnostic: a multi-class student has exactly ONE Sheet per project no
 * matter which class folder it physically sits in, so a second class can never
 * orphan or duplicate it. Returns a Spreadsheet or null. SOLO only (skips the
 * group sheets, which carry no @-token name and never match by email).
 */
function findSoloSheetInProject_(actorEmail, project) {
  // Fast path: the dashboard manifest already maps (project,email) → sheet id.
  // Verify it's a live, non-trashed file before trusting it (a merge trashes the
  // solo Sheet; forgetSoloSheetId_ usually drops the entry, but be defensive).
  const entry = loadProjectManifest_(project.projectId)[String(actorEmail).toLowerCase()];
  if (entry && entry.id) {
    try {
      const f = DriveApp.getFileById(entry.id);
      if (f && !f.isTrashed()) return SpreadsheetApp.openById(entry.id);
    } catch (e) { /* stale manifest id — fall through to the Drive walk */ }
  }
  const projectFolder = DriveApp.getFolderById(project.rootFolderId);
  const folders = projectFolder.getFolders();
  while (folders.hasNext()) {
    const cf = folders.next();
    const nm = cf.getName();
    if (nm === NAMES.ARCHIVED_FOLDER || nm === NAMES.ARCHIVED_STUDENTS_FOLDER) continue;
    const file = findSoloSheetFile_(cf, actorEmail);
    if (file) return SpreadsheetApp.openById(file.getId());
  }
  return null;
}

/**
 * The per-(student, project) Sheet, fully initialized. Idempotent. SOLO
 * ONLY — bypasses group routing, so un-merge can rebuild a member's personal
 * Sheet even while the registry still lists them as grouped.
 */
function findOrCreateSoloSheet_(actorEmail, project) {
  const identity = getStudentIdentity_(actorEmail);
  if (!identity) {
    throw new Error(`Email ${actorEmail} is not on the roster — refusing to provision.`);
  }
  const sheetName = soloSheetName_(project.name, actorEmail);
  // Find an existing Sheet anywhere in the project (class-agnostic), then
  // self-migrate any legacy bare-email name to the friendly form on first touch.
  const existing = findSoloSheetInProject_(actorEmail, project);
  if (existing) {
    const file = DriveApp.getFileById(existing.getId());
    if (file.getName() !== sheetName) file.setName(sheetName);
    return existing;
  }
  // Create under the project class the student shares (deterministic placement).
  const className = resolveProjectClassForStudent_(actorEmail, project);
  const projectFolder = DriveApp.getFolderById(project.rootFolderId);
  const classFolder = findOrCreateClassFolder_(projectFolder, className || 'Unassigned');
  const ss = SpreadsheetApp.create(sheetName);
  const newFile = DriveApp.getFileById(ss.getId());
  classFolder.addFile(newFile);
  DriveApp.getRootFolder().removeFile(newFile);
  // Rename the default Sheet1 → Meta, then add Sources + Highlights
  const sheets = ss.getSheets();
  sheets[0].setName(TABS.META);
  ss.insertSheet(TABS.SOURCES);
  ss.insertSheet(TABS.HIGHLIGHTS);
  ensureHeaders_(getTab_(ss, TABS.META), HEADERS.META);
  ensureHeaders_(getTab_(ss, TABS.SOURCES), HEADERS.SOURCES);
  ensureHeaders_(getTab_(ss, TABS.HIGHLIGHTS), HEADERS.HIGHLIGHTS);
  // Populate Meta (single row). `class` is the placement class (informational
  // only now — the Sheet is resolved by (project,email), never by class); the
  // teacher is that class's teacher.
  appendRow_(getTab_(ss, TABS.META), HEADERS.META, {
    studentName: (String(identity.Last || '') + ', ' + String(identity.First || '')).replace(/^, |, $/g, ''),
    studentEmail: actorEmail,
    class: className,
    teacher: classTeacher_(className),
    projectId: project.projectId,
    groupId: '',
  });
  // Record the new solo Sheet (id + tab gids) in the dashboard manifest so the
  // Teacher Console resolves + CSV-exports it directly instead of walking Drive
  // per student. Recorded only on CREATE — the find-existing path above runs on
  // every write and must stay free of manifest churn. Best-effort: failure here
  // never blocks a write (the dashboard falls back to the Drive walk + backfills
  // on miss).
  recordSoloSheetForSs_(project.projectId, actorEmail, ss);
  return ss;
}
