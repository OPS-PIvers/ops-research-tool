/** Projects registry CRUD. The registry is the source of truth for project existence. */

var PROJECTS_CACHE_TTL_SEC = 120;

// Cached (05_cache.js): the registry is read on every extension + console
// request but only changes on a teacher action, each of which calls
// invalidateProjectsCache_. Rows come back JSON round-tripped (Dates → strings).
function listProjects_() {
  return cachedJson_('projects', PROJECTS_CACHE_TTL_SEC, () => {
    const ss = SpreadsheetApp.openById(CONFIG.PROJECTS_SHEET_ID);
    return readAllAsObjects_(getTab_(ss, TABS.PROJECTS), HEADERS.PROJECTS);
  });
}

function getProject_(projectId) {
  const all = listProjects_();
  return all.find((p) => p.projectId === projectId) || null;
}

function listActiveProjects_() {
  return listProjects_().filter((p) => p.status === PROJECT_STATUS.ACTIVE);
}

/** Active projects whose memberClasses intersect ANY of the student's classes. */
function listActiveProjectsForStudent_(actorEmail) {
  const classes = getStudentClasses_(actorEmail);
  if (classes.length === 0) return [];
  return studentEligibleProjects_(classes, listActiveProjects_());
}

/**
 * Create a project. Returns the new project object.
 * Caller responsibility: ensure caller is staff (gating done at endpoint layer).
 */
function createProject_({ name, schoolYear, bundleId, memberClasses, createdBy, requirements }) {
  if (!name) throw new Error('Project name required');
  if (!schoolYear) throw new Error('schoolYear required');
  if (!bundleId) throw new Error('bundleId required');
  if (!getBundle_(bundleId)) throw new Error(`Unknown bundleId ${bundleId}`);
  const classes = Array.isArray(memberClasses) ? memberClasses : String(memberClasses || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (classes.length === 0) throw new Error('At least one member class required');
  const projectId = uuid_();
  const projectFolder = findOrCreateProjectFolder_(name);
  const project = {
    projectId,
    name,
    schoolYear,
    bundleId,
    memberClasses: classes.join(','),
    status: PROJECT_STATUS.ACTIVE,
    rootFolderId: projectFolder.getId(),
    createdBy,
    createdAt: nowIso_(),
    requirements: JSON.stringify(requirements || { requireAnnotation: true }),
  };
  const ss = SpreadsheetApp.openById(CONFIG.PROJECTS_SHEET_ID);
  appendRow_(getTab_(ss, TABS.PROJECTS), HEADERS.PROJECTS, project);
  invalidateProjectsCache_();
  return project;
}

function archiveProject_(projectId) {
  flipProjectStatus_(projectId, PROJECT_STATUS.ARCHIVED);
}

function unarchiveProject_(projectId) {
  flipProjectStatus_(projectId, PROJECT_STATUS.ACTIVE);
}

/**
 * One-time (idempotent): ensure the Projects tab header row carries the
 * trailing `requirements` column. ensureHeaders_ appends a missing trailing
 * label and is a no-op once present. Existing rows need no backfill — an empty
 * cell parses to defaults. Run once from the editor after deploy.
 *
 * NOTE: deliberately NO trailing underscore — GAS hides `_`-suffixed functions
 * from the editor's Run ▸ function dropdown, so an editor-run entry point must
 * be named without one (same reason the devTest and devSeed entry points have
 * no underscore).
 */
function migrateAddRequirements() {
  const ss = SpreadsheetApp.openById(CONFIG.PROJECTS_SHEET_ID);
  ensureHeaders_(getTab_(ss, TABS.PROJECTS), HEADERS.PROJECTS);
  invalidateProjectsCache_();
  return { ok: true, headers: HEADERS.PROJECTS };
}
