/**
 * Single point of environment config for the extension.
 *
 * Mirrors the philosophy of apps-script/src/00_config.js: one place to edit
 * when the deployment moves. Reload the extension after changing.
 *
 * The OAuth client ID also has to be set in manifest.json under oauth2.client_id —
 * keep them in sync.
 */
const CONFIG = {
  // Deployed GAS Web App URL ending in /exec. Paste after the first deploy
  // from the GAS editor. The CI workflow updates the underlying version but
  // never changes this URL — once published, it's stable.
  WEB_APP_URL: 'https://script.google.com/a/macros/orono.k12.mn.us/s/AKfycbwaWJe2cbmS3C0-HeKVI_Q0vALI8Jq-ivNZTcFZT_UuHHvBdBxSN0nwCwTpQrOI8FA/exec',

  // OAuth client ID from the GCP project. Also set in manifest.json (must
  // match). Used by chrome.identity.getAuthToken.
  OAUTH_CLIENT_ID: '251187181508-37t9ogl23osddoan29vjjq12331kh8un.apps.googleusercontent.com',

  // How often the background service worker drains the offline queue.
  // chrome.alarms minimum is 1 minute on production extensions.
  DRAIN_PERIOD_MINUTES: 1,

  // Max items in one POST batch to the GAS doPost. Apps Script execution
  // time per request is ~6 min, but big payloads are slow to serialize.
  // 50 is conservative; raise if real-world batches stay smaller.
  MAX_BATCH_SIZE: 50,

  // Cap on retry backoff after repeated failures. Items past this are still
  // retained in the queue (never silently dropped) — they just retry less
  // aggressively until success.
  MAX_BACKOFF_MS: 5 * 60 * 1000,
};

// Export to globals — both content scripts (via include order) and the
// service worker (via importScripts) pick this up.
if (typeof self !== 'undefined') self.CONFIG = CONFIG;
