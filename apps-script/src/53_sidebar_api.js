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
/**
 * google.script.run silently delivers `null` to the client's success handler
 * when the return payload contains a Date object (the HtmlService serializer
 * can't carry it — JSON.stringify can, which is why a server-side test passes
 * while the live sidebar shows "Could not load project data."). Sheets coerces
 * any date-looking cell (e.g. a scraped "2020-04-16") into a Date on read, so
 * flatten every Date back to a plain string before returning. Date-only ISO
 * keeps the citation formatter happy (formatMlaDate_ parses it); an unparseable
 * Date becomes ''.
 */
function flattenRowDatesForTransfer_(row) {
  if (!row) return row;
  Object.keys(row).forEach((k) => {
    const v = row[k];
    if (Object.prototype.toString.call(v) === '[object Date]') {
      row[k] = isNaN(v.getTime()) ? '' : Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
  });
  return row;
}

function sidebarGetProjectData(projectId) {
  // Always return a structured result. A bare throw reaches the client as a
  // generic google.script.run failure (or, if the payload can't serialize, a
  // detail-free success(null) → the dead-end "Could not load project data.").
  // Catching here means the sidebar can show the ACTUAL reason instead.
  try {
    const actorEmail = getActorEmail_();
    if (!projectId) throw new Error('projectId required');
    const project = getProject_(projectId);
    if (!project) throw new Error('Unknown project ' + projectId);
    // Collapse duplicate source rows for the same page (same URL + author) so the
    // dropdown / evidence list show one source per page (see dedupeSourcesByUrl_).
    const rawSources = readSourcesForActor_(actorEmail, projectId);
    const rawHighlights = readHighlightsForActor_(actorEmail, projectId);
    const deduped = dedupeSourcesByUrl_(rawSources, rawHighlights);
    // If duplicates existed, physically remove them so they stop bloating every
    // read. Best-effort + lock-guarded; the data returned below is already
    // deduped in-memory regardless of whether the cleanup write runs.
    if (deduped.sources.length !== rawSources.length) {
      tryPersistDedupe_(actorEmail, project);
    }
    const sources = deduped.sources;
    const highlights = deduped.highlights;
    const bundle = getBundle_(project.bundleId);
    const style = (bundle && bundle.style) || 'mla';
    sources.forEach((s) => {
      // Pre-parse JSON columns so the client doesn't re-parse per render.
      s.citationFieldsParsed = parseJsonColumn_(s.citationFields);
      s.scrapedExtraParsed = parseJsonColumn_(s.scrapedExtra);
      // Precompute the in-text citation so the sidebar's "Copy citation" button
      // is instant — no per-click server round-trip. One malformed source must
      // not blank the entire project load, so isolate the formatter per row.
      // buildCitationFields_ (NOT 62's parseCitationFields_) so a scraped-only
      // source still produces a citation — see buildCitationFields_'s note.
      try {
        s.inlineCitation = formatInlineCitation(buildCitationFields_(s), style, '');
      } catch (e) {
        s.inlineCitation = '';
      }
      flattenRowDatesForTransfer_(s);
    });
    highlights.forEach(flattenRowDatesForTransfer_);
    return { ok: true, sources, highlights };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
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

/**
 * Insert/replace the bibliography. annotated=true → "Annotated Bibliography",
 * annotated=false → "Works Cited". Defaults to annotated when the flag is
 * omitted (back-compat). Exposed under the sidebar* namespace.
 */
function sidebarInsertBibliography(projectId, annotated) {
  return insertBibliography_(projectId, annotated === undefined ? true : !!annotated);
}

/** Insert an MLA parenthetical citation at the doc cursor for the given source. */
function sidebarInsertInlineCitation(projectId, sourceId, page) {
  return insertInlineCitation(projectId, sourceId, page);
}

/**
 * Delete a source AND every highlight that references it, in one shot.
 * Idempotent: deleting a sourceId that no longer exists returns
 * { ok: true, deletedHighlights: 0, deletedSource: false } — never throws.
 *
 * Implementation strategy: read all rows for each tab, filter out the
 * matches, write the kept rows back. Doing one batched setValues per tab
 * (rather than row-by-row deleteRow calls) keeps us under the GAS script
 * timeout for sources with many highlights, and avoids the half-deleted
 * states deleteRow can leave on partial failures.
 */
function sidebarDeleteSource(projectId, sourceId) {
  const actorEmail = getActorEmail_();
  if (!projectId || !sourceId) throw new Error('projectId and sourceId required');
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown project ' + projectId);
  const studentSheet = findOrCreateStudentSheet_(actorEmail, project);

  const deletedHighlights = deleteAllRowsWhere_(
    getTab_(studentSheet, TABS.HIGHLIGHTS),
    HEADERS.HIGHLIGHTS,
    'sourceId',
    sourceId
  );
  const deletedSource = deleteAllRowsWhere_(
    getTab_(studentSheet, TABS.SOURCES),
    HEADERS.SOURCES,
    'sourceId',
    sourceId
  ) > 0;
  return { ok: true, deletedHighlights, deletedSource };
}

/**
 * Batched filter-then-rewrite delete. Returns the number of rows removed.
 * Preserves header row + any trailing blank rows that were already there.
 * Safe to call on a tab with zero data rows.
 */
function deleteAllRowsWhere_(tab, headers, keyCol, keyValue) {
  if (tab.getLastRow() < 2) return 0;
  const keyIdx = headers.indexOf(keyCol);
  if (keyIdx < 0) throw new Error('Unknown column ' + keyCol);
  const dataRows = tab.getRange(2, 1, tab.getLastRow() - 1, headers.length).getValues();
  const kept = dataRows.filter((row) => row[keyIdx] !== keyValue);
  const removed = dataRows.length - kept.length;
  if (removed === 0) return 0;

  // Clear the old data range, then write back the kept rows (if any).
  tab.getRange(2, 1, dataRows.length, headers.length).clearContent();
  if (kept.length > 0) {
    tab.getRange(2, 1, kept.length, headers.length).setValues(kept);
  }
  return removed;
}

/**
 * Physically collapse duplicate source rows (same normalizedUrl + author) in
 * the student's Sheet: keep the oldest canonical row with both rows' citation
 * work merged in, repoint the duplicates' highlights onto it, and drop the
 * duplicate source rows. One batched rewrite per tab. Idempotent — a no-op when
 * there are no duplicates. Returns the number of source rows removed.
 */
function dedupeSourcesPersist_(studentSheet) {
  const srcTab = getTab_(studentSheet, TABS.SOURCES);
  const sources = readAllAsObjects_(srcTab, HEADERS.SOURCES);
  if (sources.length < 2) return 0;
  const hlTab = getTab_(studentSheet, TABS.HIGHLIGHTS);
  const highlights = readAllAsObjects_(hlTab, HEADERS.HIGHLIGHTS);

  const deduped = dedupeSourcesByUrl_(sources, highlights);
  const removed = sources.length - deduped.sources.length;
  if (removed === 0) return 0;

  rewriteTabRows_(srcTab, HEADERS.SOURCES, deduped.sources);
  rewriteTabRows_(hlTab, HEADERS.HIGHLIGHTS, deduped.highlights);
  return removed;
}

/**
 * Replace every data row (below the header) of `tab` with `objects` mapped
 * positionally through `headers`. One batched clear + setValues — mirrors the
 * filter-rewrite strategy of deleteAllRowsWhere_.
 */
function rewriteTabRows_(tab, headers, objects) {
  const lastRow = tab.getLastRow();
  if (lastRow >= 2) tab.getRange(2, 1, lastRow - 1, headers.length).clearContent();
  if (!objects || objects.length === 0) return;
  const rows = objects.map((obj) =>
    headers.map((h) => (obj[h] === null || obj[h] === undefined) ? '' : obj[h])
  );
  tab.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

/**
 * Best-effort physical dedup, serialized with a script lock so two concurrent
 * sidebar loads don't race on the rewrite. The caller's returned data is
 * already deduped in-memory, so skipping (lock held by another invocation that
 * is doing the cleanup) is harmless.
 */
function tryPersistDedupe_(actorEmail, project) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return;
  try {
    dedupeSourcesPersist_(findOrCreateStudentSheet_(actorEmail, project));
  } catch (e) {
    console.warn('[OPS] dedupe persist failed: ' + (e && e.message || e));
  } finally {
    lock.releaseLock();
  }
}

/**
 * Open the per-source editor modal. The sidebar dispatches here when the
 * student clicks "Open in editor" on a source or evidence card.
 *
 * Template bindings: projectId, sourceId, focusHighlightId, and the active
 * bundle (serialized to JSON so the modal has color swatches without an
 * extra round trip).
 *
 * The modal opens at 820x720 — empirically validated as comfortable in
 * Docs at typical laptop resolutions.
 */
function sidebarOpenSourceEditor(projectId, sourceId, focusHighlightId) {
  const actorEmail = getActorEmail_();
  if (!projectId || !sourceId) throw new Error('projectId and sourceId required');
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown project ' + projectId);

  // Verify the source belongs to this caller.
  const ss = getStudentSheetIfExists_(actorEmail, project);
  if (!ss) throw new Error('No data for this project yet');
  const sourcesTab = getTab_(ss, TABS.SOURCES);
  if (findRowByKey_(sourcesTab, HEADERS.SOURCES, 'sourceId', sourceId) < 0) {
    throw new Error('Source not found');
  }

  const bundle = listBundles_().find((b) => b.bundleId === project.bundleId) || null;

  const t = HtmlService.createTemplateFromFile('source_editor');
  t.projectId = projectId;
  t.sourceId = sourceId;
  t.focusHighlightId = focusHighlightId || '';
  t.bundleJson = JSON.stringify(bundle);
  const html = t.evaluate()
    .setWidth(820)
    .setHeight(720);
  DocumentApp.getUi().showModalDialog(html, 'Edit source');
  return { ok: true };
}
