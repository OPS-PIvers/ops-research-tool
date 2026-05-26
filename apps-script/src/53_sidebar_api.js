/**
 * Server functions called from the Docs sidebar via google.script.run.
 *
 * All functions identify the caller via Session.getActiveUser().getEmail()
 * — same trust model as the web-app endpoints in 30_endpoints.js. The
 * sidebar is loaded inside the Doc, so the caller is the Doc viewer,
 * which in our deployment is always a Workspace-domain user.
 *
 * Naming convention: `sidebar*` so the surface intended for HTML callers
 * is obvious (and so we can revoke / lint them as a group later).
 */

/**
 * Bootstrap call when the sidebar loads. Returns enough to render the
 * project picker + active context without a second round trip.
 */
function sidebarGetContext() {
  const actorEmail = getActorEmail_();
  const projects = listActiveProjectsForStudent_(actorEmail);
  const bundles = listBundles_();
  const staff = getStaffEntry_(actorEmail);
  const isStaff = !!staff;
  // Staff see ALL active projects (not just classes they're enrolled in
  // as a student, which they typically aren't). Students see only their
  // class's projects.
  const visibleProjects = isStaff ? listActiveProjects_() : projects;

  let activeProjectId = getActiveProjectForActor_(actorEmail);
  if (!activeProjectId && visibleProjects.length > 0) {
    activeProjectId = visibleProjects[0].projectId;
    setActiveProjectForActor_(actorEmail, activeProjectId);
  }
  const activeProject = visibleProjects.find((p) => p.projectId === activeProjectId) || null;
  const activeBundle = activeProject ? bundles.find((b) => b.bundleId === activeProject.bundleId) || null : null;

  return {
    ok: true,
    actor: actorEmail,
    isStaff,
    roster: getStudentRosterEntry_(actorEmail),
    projects: visibleProjects,
    bundles,
    activeProjectId,
    activeProject,
    activeBundle,
  };
}

function sidebarSetActiveProject(projectId) {
  const actorEmail = getActorEmail_();
  setActiveProjectForActor_(actorEmail, projectId || '');
  return { ok: true, activeProjectId: projectId || null };
}

/**
 * Full data dump for a project: sources + highlights for the caller. The
 * sidebar groups highlights under their sources in the UI and shows the
 * source-level citation form.
 */
function sidebarGetProjectData(projectId) {
  const actorEmail = getActorEmail_();
  if (!projectId) throw new Error('projectId required');
  if (!getProject_(projectId)) throw new Error('Unknown project ' + projectId);
  const sources = readSourcesForActor_(actorEmail, projectId);
  const highlights = readHighlightsForActor_(actorEmail, projectId);
  // Pre-parse citationFields JSON so the client doesn't re-parse per render.
  sources.forEach((s) => {
    let parsed = {};
    if (s.citationFields) {
      try { parsed = JSON.parse(s.citationFields) || {}; }
      catch (e) { parsed = {}; }
    }
    s.citationFieldsParsed = parsed;
  });
  return { ok: true, sources, highlights };
}

/**
 * Update a source's editable fields: sourceType, citationFields (object,
 * serialized to JSON), primarySecondary, annotation.
 * Other source columns are never touched here (immutable: sourceId,
 * projectId, normalizedUrl/rawUrl, scrapedXxx, createdAt, createdByEmail).
 */
function sidebarUpdateSource(patch) {
  const actorEmail = getActorEmail_();
  if (!patch || !patch.sourceId || !patch.projectId) {
    throw new Error('sourceId and projectId required');
  }
  const project = getProject_(patch.projectId);
  if (!project) throw new Error('Unknown project ' + patch.projectId);
  const studentSheet = findOrCreateStudentSheet_(actorEmail, project);
  const tab = getTab_(studentSheet, TABS.SOURCES);
  const rowIdx = findRowByKey_(tab, HEADERS.SOURCES, 'sourceId', patch.sourceId);
  if (rowIdx < 0) throw new Error('source not found');
  const row = rowToObj_(HEADERS.SOURCES, tab.getRange(rowIdx, 1, 1, HEADERS.SOURCES.length).getValues()[0]);

  // Apply patch with explicit allow-list — never let the client overwrite
  // immutable fields.
  if (patch.sourceType !== undefined) {
    if (patch.sourceType && SOURCE_TYPES.indexOf(patch.sourceType) < 0) {
      throw new Error('bad sourceType ' + patch.sourceType);
    }
    row.sourceType = patch.sourceType;
  }
  if (patch.citationFields !== undefined) {
    row.citationFields = patch.citationFields ? JSON.stringify(patch.citationFields) : '';
  }
  if (patch.primarySecondary !== undefined) {
    if (patch.primarySecondary && PRIMARY_SECONDARY.indexOf(patch.primarySecondary) < 0) {
      throw new Error('bad primarySecondary ' + patch.primarySecondary);
    }
    row.primarySecondary = patch.primarySecondary;
  }
  if (patch.annotation !== undefined) {
    row.annotation = patch.annotation || '';
    row.annotationLastEdited = nowIso_();
  }
  upsertByKey_(tab, HEADERS.SOURCES, 'sourceId', row);
  return { ok: true };
}

/**
 * Update a highlight (re-categorize, secondary tag, note). Used by the
 * sidebar's edit affordances. The on-page extension uses a separate path
 * (enqueueHighlight → drain → upsertHighlight) but ends up writing the
 * same row, so this is just the synchronous server-side equivalent.
 */
function sidebarUpdateHighlight(patch) {
  const actorEmail = getActorEmail_();
  if (!patch || !patch.highlightId || !patch.projectId) {
    throw new Error('highlightId and projectId required');
  }
  const project = getProject_(patch.projectId);
  if (!project) throw new Error('Unknown project ' + patch.projectId);
  const studentSheet = findOrCreateStudentSheet_(actorEmail, project);
  const tab = getTab_(studentSheet, TABS.HIGHLIGHTS);
  const rowIdx = findRowByKey_(tab, HEADERS.HIGHLIGHTS, 'highlightId', patch.highlightId);
  if (rowIdx < 0) throw new Error('highlight not found');
  const row = rowToObj_(HEADERS.HIGHLIGHTS, tab.getRange(rowIdx, 1, 1, HEADERS.HIGHLIGHTS.length).getValues()[0]);

  if (patch.primaryCategory !== undefined) row.primaryCategory = patch.primaryCategory || '';
  if (patch.secondaryCategory !== undefined) row.secondaryCategory = patch.secondaryCategory || '';
  if (patch.note !== undefined) row.note = patch.note || '';
  upsertByKey_(tab, HEADERS.HIGHLIGHTS, 'highlightId', row);
  return { ok: true };
}

function sidebarDeleteHighlight(highlightId, projectId, cascadeSource) {
  const actorEmail = getActorEmail_();
  if (!highlightId || !projectId) throw new Error('highlightId and projectId required');
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown project ' + projectId);
  const studentSheet = findOrCreateStudentSheet_(actorEmail, project);
  const removedSourceId = deleteHighlightById_(studentSheet, highlightId);
  let sourceRemoved = false;
  if (cascadeSource && removedSourceId) {
    sourceRemoved = deleteSourceIfOrphaned_(studentSheet, removedSourceId);
  }
  return { ok: true, deletedHighlight: removedSourceId !== null, sourceRemoved };
}

/**
 * Render a preview of how a citation will look (for the sidebar's
 * "live preview" pane). Same logic as the bibliography inserter uses.
 */
function sidebarPreviewCitation(fields, style) {
  return formatCitation(fields || {}, style || 'mla');
}

/** The big button — same as insertAnnotatedBibliography but exposed under the sidebar* namespace. */
function sidebarInsertBibliography(projectId) {
  return insertAnnotatedBibliography(projectId);
}
