/**
 * Project lifecycle helpers — shared by single-project archive/unarchive
 * (consoleArchiveProject / consoleUnarchiveProject) and bulk archive
 * school year (adminArchiveSchoolYear).
 *
 * Three concerns combined here so caller code is uniform:
 *   1. Flip status cell on the Projects registry.
 *   2. Move the project's Drive folder under (or back from) Archived/.
 *   3. Clear any user_prefs activeProjectId that still points at the
 *      archived project (so students re-pick on next extension load
 *      instead of trying to write to an archived project and getting
 *      a 'refusing writes' error from doPost).
 */

/**
 * Set Projects.status for a project. Used by both archive and unarchive
 * paths (and by adminArchiveSchoolYear, which flips many at once).
 *
 * Replaces the in-place setValue logic that used to live in
 * archiveProject_ / unarchiveProject_ in 12_projects.js. Those wrappers
 * now delegate to this so the bulk path can share the code without
 * duplicating column-index math.
 */
function flipProjectStatus_(projectId, newStatus) {
  if (newStatus !== PROJECT_STATUS.ACTIVE && newStatus !== PROJECT_STATUS.ARCHIVED) {
    throw new Error('flipProjectStatus_: bad newStatus ' + newStatus);
  }
  const ss = SpreadsheetApp.openById(CONFIG.PROJECTS_SHEET_ID);
  const tab = getTab_(ss, TABS.PROJECTS);
  const rowIdx = findRowByKey_(tab, HEADERS.PROJECTS, 'projectId', projectId);
  if (rowIdx < 0) throw new Error('Unknown projectId ' + projectId);
  const statusCol = HEADERS.PROJECTS.indexOf('status') + 1;
  tab.getRange(rowIdx, statusCol).setValue(newStatus);
  invalidateProjectsCache_();
}

/**
 * Move a project's root folder under root/Archived/. Idempotent: if it's
 * already inside Archived/, this is a no-op. Find-or-creates the Archived
 * folder lazily.
 *
 * Implementation note: DriveApp's "move" is `addFolder` + `removeFolder`
 * on the parent. A folder can have multiple parents (shortcuts); we
 * normalize by ensuring exactly one (the Archived folder).
 */
function moveProjectToArchived_(projectFolderId) {
  const root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);
  const archived = findChildFolder_(root, NAMES.ARCHIVED_FOLDER) || root.createFolder(NAMES.ARCHIVED_FOLDER);
  const projectFolder = DriveApp.getFolderById(projectFolderId);

  // If already under Archived, no-op.
  const parents = projectFolder.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === archived.getId()) return;
  }

  // Add new parent, remove all other parents (covers root + any drift).
  archived.addFolder(projectFolder);
  const all = projectFolder.getParents();
  while (all.hasNext()) {
    const p = all.next();
    if (p.getId() !== archived.getId()) p.removeFolder(projectFolder);
  }
}

/**
 * Inverse of moveProjectToArchived_. Move the project folder back to
 * root. Idempotent: if it's already at root, no-op.
 */
function restoreProjectFromArchived_(projectFolderId) {
  const root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);
  const projectFolder = DriveApp.getFolderById(projectFolderId);

  const parents = projectFolder.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === root.getId()) return;
  }

  root.addFolder(projectFolder);
  const all = projectFolder.getParents();
  while (all.hasNext()) {
    const p = all.next();
    if (p.getId() !== root.getId()) p.removeFolder(projectFolder);
  }
}

/**
 * Walk ScriptProperties (where user prefs live; see 04_user_prefs.js for
 * key shape `prefs:<actorEmail>:activeProjectId`) and delete any
 * activeProjectId entry whose value equals `projectId`. Used by both
 * single-project and bulk archive paths.
 *
 * Returns the count of properties cleared.
 */
function clearStaleActiveProjectPrefs_(projectId) {
  if (!projectId) return 0;
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  let cleared = 0;
  Object.keys(all).forEach((key) => {
    if (!key.endsWith(':activeProjectId')) return;
    if (all[key] === projectId) {
      props.deleteProperty(key);
      cleared++;
    }
  });
  return cleared;
}

/**
 * The full per-project archive code path — used by both the single-project
 * console endpoint and the bulk-year endpoint.
 *
 * Steps:
 *   1. flipProjectStatus_(projectId, 'archived')
 *   2. moveProjectToArchived_(project.rootFolderId)
 *   3. clearStaleActiveProjectPrefs_(projectId)
 *   4. appendAuditEvent_({projectId, action, actor, detail})
 *
 * Errors at steps 2+ are caught and collected — once status is flipped
 * (cheap, atomic), the project is "archived" for all intents. Drive move
 * or pref clear failures are surfaced but do not roll back.
 *
 * Returns { ok, archived: bool, errors: [{step, error}] }.
 */
function archiveProjectFully_(projectId, action, actor, detail) {
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown projectId ' + projectId);
  if (project.status === PROJECT_STATUS.ARCHIVED) {
    return { ok: true, archived: false, errors: [] };  // idempotent skip
  }
  const errors = [];
  // Step 1 — status flip (cheap, must succeed)
  flipProjectStatus_(projectId, PROJECT_STATUS.ARCHIVED);
  // Step 2 — Drive move
  try { moveProjectToArchived_(project.rootFolderId); }
  catch (e) { errors.push({ step: 'moveFolder', error: String(e && e.message || e) }); }
  // Step 3 — pref clear
  try { clearStaleActiveProjectPrefs_(projectId); }
  catch (e) { errors.push({ step: 'clearPrefs', error: String(e && e.message || e) }); }
  // Step 4 — audit
  try { appendAuditEvent_({ projectId, action: action || AUDIT_ACTIONS.ARCHIVE, actor, detail: detail || '' }); }
  catch (e) { errors.push({ step: 'audit', error: String(e && e.message || e) }); }
  return { ok: true, archived: true, errors };
}

/**
 * The full per-project unarchive code path. Restores Drive folder, flips
 * status, audits. Does NOT restore previously-cleared activeProjectId
 * prefs (students re-select on next extension load).
 */
function unarchiveProjectFully_(projectId, actor, detail) {
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown projectId ' + projectId);
  if (project.status === PROJECT_STATUS.ACTIVE) {
    return { ok: true, unarchived: false, errors: [] };
  }
  const errors = [];
  flipProjectStatus_(projectId, PROJECT_STATUS.ACTIVE);
  try { restoreProjectFromArchived_(project.rootFolderId); }
  catch (e) { errors.push({ step: 'restoreFolder', error: String(e && e.message || e) }); }
  try { appendAuditEvent_({ projectId, action: AUDIT_ACTIONS.UNARCHIVE, actor, detail: detail || '' }); }
  catch (e) { errors.push({ step: 'audit', error: String(e && e.message || e) }); }
  return { ok: true, unarchived: true, errors };
}

/**
 * Bulk archive every active project with the given schoolYear.
 * Step 1 (status flip) happens for ALL first so the registry reflects
 * intent fast. Then steps 2-4 happen per project, errors collected.
 *
 * Returns { ok, schoolYear, archived: [projectId, ...], skipped: [], errors: [] }.
 * archived = projects whose status was flipped this call.
 * skipped  = projects already archived (no-op).
 * errors   = {projectId, step, error} entries from the move/prefs/audit steps.
 */
function archiveSchoolYear_(schoolYear, actor) {
  const all = listProjects_();
  const matches = all.filter((p) => p.schoolYear === schoolYear && p.status === PROJECT_STATUS.ACTIVE);
  const skipped = all.filter((p) => p.schoolYear === schoolYear && p.status === PROJECT_STATUS.ARCHIVED).map((p) => p.projectId);

  // Phase A — flip status for every match first.
  matches.forEach((p) => flipProjectStatus_(p.projectId, PROJECT_STATUS.ARCHIVED));

  // Phase B — Drive moves + prefs + audit per project.
  const errors = [];
  matches.forEach((p) => {
    try { moveProjectToArchived_(p.rootFolderId); }
    catch (e) { errors.push({ projectId: p.projectId, step: 'moveFolder', error: String(e && e.message || e) }); }
    try { clearStaleActiveProjectPrefs_(p.projectId); }
    catch (e) { errors.push({ projectId: p.projectId, step: 'clearPrefs', error: String(e && e.message || e) }); }
    try {
      appendAuditEvent_({
        projectId: p.projectId,
        action: AUDIT_ACTIONS.ARCHIVE_YEAR,
        actor,
        detail: 'schoolYear=' + schoolYear,
      });
    } catch (e) { errors.push({ projectId: p.projectId, step: 'audit', error: String(e && e.message || e) }); }
  });

  return {
    ok: true,
    schoolYear,
    archived: matches.map((p) => p.projectId),
    skipped,
    errors,
  };
}
