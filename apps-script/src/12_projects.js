/** Projects registry CRUD. The registry is the source of truth for project existence. */

function listProjects_() {
  const ss = SpreadsheetApp.openById(CONFIG.PROJECTS_SHEET_ID);
  return readAllAsObjects_(getTab_(ss, TABS.PROJECTS), HEADERS.PROJECTS);
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
function createProject_({ name, schoolYear, bundleId, memberClasses, createdBy }) {
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
  };
  const ss = SpreadsheetApp.openById(CONFIG.PROJECTS_SHEET_ID);
  appendRow_(getTab_(ss, TABS.PROJECTS), HEADERS.PROJECTS, project);
  return project;
}

function archiveProject_(projectId) {
  flipProjectStatus_(projectId, PROJECT_STATUS.ARCHIVED);
}

function unarchiveProject_(projectId) {
  flipProjectStatus_(projectId, PROJECT_STATUS.ACTIVE);
}
