/**
 * Web App endpoints.
 *
 * Deploy with:
 *   Execute as:    Me  (so the script can write to district Drive without
 *                       each student needing direct Sheet access)
 *   Access:        Anyone within domain (orono.k12.mn.us)
 *
 * Within-domain access lets Session.getActiveUser().getEmail() return the
 * caller's email even when Execute-as is the owner.
 */

/**
 * doPost: write batch. JSON body shape:
 *   {
 *     projectId: '...',
 *     sources:    [ {sourceId, rawUrl, ...}, ... ],
 *     highlights: [ {highlightId, sourceId, primaryCategory, ...}, ... ]
 *   }
 *
 * Identity comes from Session, not the payload. The extension cannot spoof.
 * Returns { ok, written: {sources, highlights}, errors }.
 */
function doPost(e) {
  return jsonResponse_(handlePost_(e));
}

function handlePost_(e) {
  try {
    const actorEmail = getActorEmail_();
    const body = JSON.parse(e.postData.contents);
    // Special-case lightweight actions that don't need a projectId / sheet open.
    if (body.action === 'setActiveProject') {
      setActiveProjectForActor_(actorEmail, body.projectId || '');
      return { ok: true, actor: actorEmail, activeProjectId: body.projectId || null };
    }

    if (!body.projectId) throw new Error('projectId required');
    const project = getProject_(body.projectId);
    if (!project) throw new Error(`Unknown projectId ${body.projectId}`);
    if (project.status !== PROJECT_STATUS.ACTIVE) {
      throw new Error(`Project ${body.projectId} is ${project.status}; refusing writes`);
    }
    // Stamp the actor email onto every payload row — never trust the client's claim.
    const sources = (body.sources || []).map((s) => ({ ...s, createdByEmail: actorEmail, projectId: body.projectId }));
    const highlights = (body.highlights || []).map((h) => ({ ...h, createdByEmail: actorEmail, projectId: body.projectId }));
    const deletes = body.deletes || [];

    // One Sheet open per request — provisioning is lazy.
    const studentSheet = findOrCreateStudentSheet_(actorEmail, project);

    const errors = [];
    let writtenSources = 0;
    let writtenHighlights = 0;
    let deletedHighlights = 0;
    let deletedSources = 0;
    sources.forEach((s) => {
      try { upsertSource_(studentSheet, s); writtenSources++; }
      catch (err) { errors.push({ kind: 'source', id: s.sourceId, error: String(err) }); }
    });
    highlights.forEach((h) => {
      try { upsertHighlight_(studentSheet, h); writtenHighlights++; }
      catch (err) { errors.push({ kind: 'highlight', id: h.highlightId, error: String(err) }); }
    });
    deletes.forEach((d) => {
      try {
        if (d.kind === 'highlight') {
          const removedSourceId = deleteHighlightById_(studentSheet, d.id);
          if (removedSourceId !== null) deletedHighlights++;
          if (d.cascadeSource && removedSourceId) {
            if (deleteSourceIfOrphaned_(studentSheet, removedSourceId)) deletedSources++;
          }
        }
      } catch (err) {
        errors.push({ kind: 'delete', id: d.id, error: String(err) });
      }
    });

    return {
      ok: errors.length === 0,
      actor: actorEmail,
      projectId: body.projectId,
      written: { sources: writtenSources, highlights: writtenHighlights },
      deleted: { highlights: deletedHighlights, sources: deletedSources },
      errors,
    };
  } catch (err) {
    console.error(err.stack || err);
    return { ok: false, error: String(err && err.message || err) };
  }
}

/**
 * doGet: read dispatcher. Use ?action=... query string.
 *
 *   action=me             → caller's roster + staff entry
 *   action=projects       → active projects the caller belongs to (extension dropdown)
 *   action=bundles        → all bundles (for picking colors/labels)
 *   action=mySources      → sources for caller in ?projectId=...
 *   action=myHighlights   → highlights for caller in ?projectId=...
 *
 * Phase 4 will add teacher dashboards / project-wide reads (admin-gated).
 */
function doGet(e) {
  return jsonResponse_(handleGet_(e));
}

function handleGet_(e) {
  try {
    const actorEmail = getActorEmail_();
    const params = e.parameter || {};
    const action = params.action || 'me';

    switch (action) {
      case 'me':
        return {
          ok: true,
          actor: actorEmail,
          roster: getStudentRosterEntry_(actorEmail),
          staff: getStaffEntry_(actorEmail),
        };

      case 'projects':
        return { ok: true, projects: listActiveProjectsForStudent_(actorEmail) };

      case 'bundles':
        return { ok: true, bundles: listBundles_() };

      case 'mySources': {
        if (!params.projectId) throw new Error('projectId required');
        return { ok: true, sources: readSourcesForActor_(actorEmail, params.projectId) };
      }

      case 'myHighlights': {
        if (!params.projectId) throw new Error('projectId required');
        return { ok: true, highlights: readHighlightsForActor_(actorEmail, params.projectId) };
      }

      case 'findSource': {
        if (!params.projectId) throw new Error('projectId required');
        if (!params.rawUrl) throw new Error('rawUrl required');
        const normalized = normalizeUrl_(params.rawUrl);
        const existing = findSourceByNormalizedUrl_(actorEmail, params.projectId, normalized);
        return { ok: true, normalizedUrl: normalized, source: existing };
      }

      case 'getActiveProject': {
        // Server-side activeProjectId so the Docs sidebar and the Chrome
        // extension stay in sync without each side maintaining its own.
        return { ok: true, activeProjectId: getActiveProjectForActor_(actorEmail) };
      }

      default:
        throw new Error(`Unknown action ${action}`);
    }
  } catch (err) {
    console.error(err.stack || err);
    return { ok: false, error: String(err && err.message || err) };
  }
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
