/**
 * Audit log for project lifecycle events.
 *
 * Storage: a new `Audit` tab on the Projects registry workbook
 * (CONFIG.PROJECTS_SHEET_ID). Events are project-scoped; roster events
 * are out of scope for sub-project C.
 *
 * Schema (HEADERS.AUDIT):
 *   eventId     — server-generated UUID
 *   projectId   — FK to Projects.projectId
 *   action      — one of AUDIT_ACTIONS (archive | unarchive | archive_year)
 *   actor       — email of the staff member who triggered the action
 *   at          — ISO 8601 timestamp
 *   detail      — free-text reason / metadata (e.g., 'schoolYear=2025-26')
 *
 * Performance: <500 rows/year expected, full-scan reads acceptable.
 */

/**
 * Idempotent: create the Audit tab + header row if absent. Called lazily
 * by appendAuditEvent_ and latestUnarchiveFor_ so a fresh project doesn't
 * need a separate setup step.
 */
function ensureAuditTab_() {
  const ss = SpreadsheetApp.openById(CONFIG.PROJECTS_SHEET_ID);
  let tab = ss.getSheetByName(TABS.AUDIT);
  if (!tab) tab = ss.insertSheet(TABS.AUDIT);
  ensureHeaders_(tab, HEADERS.AUDIT);
  return tab;
}

/**
 * Append one audit row. Caller passes {projectId, action, actor, detail}.
 * eventId + at are stamped here.
 *
 * Returns the full event object (incl. eventId, at) so callers can return
 * it to the client if they ever want to (today, no client surface reads
 * append results — only latestUnarchiveFor_ feeds the banner).
 */
function appendAuditEvent_(args) {
  if (!args || !args.action) throw new Error('appendAuditEvent_: action required');
  if (!args.actor)           throw new Error('appendAuditEvent_: actor required');
  const event = {
    eventId:   uuid_(),
    projectId: String(args.projectId || ''),
    action:    String(args.action),
    actor:     String(args.actor).toLowerCase(),
    at:        nowIso_(),
    detail:    String(args.detail || ''),
  };
  const tab = ensureAuditTab_();
  appendRow_(tab, HEADERS.AUDIT, event);
  invalidateAuditCache_(event.projectId);
  return event;
}

var AUDIT_CACHE_TTL_SEC = 300;

/**
 * Most recent unarchive event for a project, or null. Used by
 * consoleGetProjectDashboard to attach the "recently unarchived"
 * banner data (Section 10.3 of the spec).
 *
 * Full-tab scan — fine at the data volumes expected.
 */
function latestUnarchiveFor_(projectId) {
  if (!projectId) return null;
  // Cached per project (05_cache.js) — this sits on every dashboard load and
  // the answer only changes when appendAuditEvent_ writes (which drops it).
  return cachedJson_('audit:unarchive:' + String(projectId), AUDIT_CACHE_TTL_SEC, () => {
    const tab = ensureAuditTab_();
    const rows = readAllAsObjects_(tab, HEADERS.AUDIT);
    let latest = null;
    rows.forEach((r) => {
      if (r.projectId !== projectId) return;
      if (r.action !== AUDIT_ACTIONS.UNARCHIVE) return;
      if (latest === null || String(r.at || '') > String(latest.at || '')) latest = r;
    });
    return latest;
  });
}

/**
 * Return all audit events for a project ordered newest first. Not used by
 * client surfaces today but useful for future debugging and for the
 * devTestArchiveSchoolYear assertion that audit events were written.
 */
function listAuditEventsForProject_(projectId) {
  const tab = ensureAuditTab_();
  const rows = readAllAsObjects_(tab, HEADERS.AUDIT);
  return rows
    .filter((r) => r.projectId === projectId)
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}
