/**
 * Single config block — the build plan calls for IDs to live here and ONLY here.
 * Migration between owners / Drives = edit this block, push, redeploy. Nothing else.
 *
 * To populate: run setup() once from the Apps Script editor. It creates anything
 * missing and prints IDs to the log. Paste them in here, push again with `clasp push`.
 */
const CONFIG = {
  // Drive folder that contains everything (Roster workbook, registries, per-project folders).
  // Empty string means "not yet set — setup() will create it and log the ID".
  ROOT_FOLDER_ID: '',

  // Roster + Staff workbook (tabs: Roster, Staff). Single workbook, district-wide.
  ROSTER_SHEET_ID: '',

  // Projects registry Sheet (one tab listing every project ever created).
  PROJECTS_SHEET_ID: '',

  // Bundles config Sheet (immutable rows; one row per category bundle).
  BUNDLES_SHEET_ID: '',

  // The Google account that owns the script + data during PoC. Used as a sanity
  // check inside setup() so a different account doesn't accidentally re-bootstrap.
  // Once migrated to a Shared Drive, this can be the service account or left blank.
  OWNER_EMAIL: 'paul.ivers@orono.k12.mn.us',

  // Toggle to allow setup() to (re-)create missing artifacts. Flip off in production
  // to make setup() report-only.
  ALLOW_BOOTSTRAP: true,
};
