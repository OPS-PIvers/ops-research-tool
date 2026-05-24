/**
 * Single config block — the build plan calls for IDs to live here and ONLY here.
 * Migration between owners / Drives = edit this block, push, redeploy. Nothing else.
 *
 * To populate: run setup() once from the Apps Script editor. It creates anything
 * missing and prints IDs to the log. Paste them in here, push again with `clasp push`.
 */
const CONFIG = {
  // Drive folder that contains everything (Roster workbook, registries, per-project folders).
  ROOT_FOLDER_ID: '13bA8j83R-wZDaewWcOpYisWxH_Ojwhu4',

  // Roster + Staff workbook (tabs: Roster, Staff). Single workbook, district-wide.
  ROSTER_SHEET_ID: '17vs9bb7oFoiT_D7Z4z2vQfLzWyEpLMd21ZWUDovSvEs',

  // Projects registry Sheet (one tab listing every project ever created).
  PROJECTS_SHEET_ID: '1FSCdO5zcnGhIr5Wdm4-YFSSIcjskWlivffm-ivkJvKE',

  // Bundles config Sheet (immutable rows; one row per category bundle).
  BUNDLES_SHEET_ID: '1Ht6ggmLyqD-VhepLr10bE8lO28zLX9-1NcfXirxHIYk',

  // The Google account that owns the script + data during PoC. Used as a sanity
  // check inside setup() so a different account doesn't accidentally re-bootstrap.
  // Once migrated to a Shared Drive, this can be the service account or left blank.
  OWNER_EMAIL: 'paul.ivers@orono.k12.mn.us',

  // Toggle to allow setup() to (re-)create missing artifacts. Flip off in production
  // to make setup() report-only.
  ALLOW_BOOTSTRAP: true,
};
