/**
 * Per-user preferences storage. Used to sync the active project between
 * the Chrome extension and the Docs sidebar so a student doesn't have to
 * pick the project in two places.
 *
 * Web App is deployed "Execute as: Me", so PropertiesService's user-scope
 * properties actually live under the script owner, not the caller. To keep
 * prefs per-caller we namespace them in scriptProperties as
 *   prefs:<actorEmail>:<key>
 */

const PREFS_PREFIX = 'prefs:';

function userPrefKey_(actorEmail, key) {
  return PREFS_PREFIX + String(actorEmail).toLowerCase() + ':' + key;
}

function getUserPref_(actorEmail, key) {
  const v = PropertiesService.getScriptProperties().getProperty(userPrefKey_(actorEmail, key));
  return v === null ? null : v;
}

function setUserPref_(actorEmail, key, value) {
  if (value === null || value === undefined || value === '') {
    PropertiesService.getScriptProperties().deleteProperty(userPrefKey_(actorEmail, key));
    return;
  }
  PropertiesService.getScriptProperties().setProperty(userPrefKey_(actorEmail, key), String(value));
}

/** Convenience helpers for the activeProjectId pref. */
function getActiveProjectForActor_(actorEmail) {
  return getUserPref_(actorEmail, 'activeProjectId');
}

function setActiveProjectForActor_(actorEmail, projectId) {
  setUserPref_(actorEmail, 'activeProjectId', projectId || '');
}
