/**
 * One-shot bootstrap. Run from the Apps Script editor.
 *
 * Idempotent: re-running just reports current state.
 *
 *   1. Creates "OPS Research Tool" folder in My Drive if missing.
 *   2. Creates Roster + Staff workbook (with headers, empty data).
 *   3. Creates Projects registry workbook.
 *   4. Creates Bundles registry workbook + seeds the History Day bundle.
 *   5. Logs every ID. Paste them into 00_config.js and `clasp push`.
 */
function setup() {
  const me = Session.getEffectiveUser().getEmail();
  if (CONFIG.OWNER_EMAIL && me !== CONFIG.OWNER_EMAIL) {
    throw new Error(
      `setup() running as ${me} but CONFIG.OWNER_EMAIL is ${CONFIG.OWNER_EMAIL}. ` +
      'Either fix CONFIG.OWNER_EMAIL or run from the owner account.'
    );
  }
  if (!CONFIG.ALLOW_BOOTSTRAP) {
    throw new Error('CONFIG.ALLOW_BOOTSTRAP is false — flip on temporarily to bootstrap.');
  }

  const root = bootstrapRootFolder_();
  const roster = bootstrapRosterWorkbook_(root);
  const projects = bootstrapProjectsWorkbook_(root);
  const bundles = bootstrapBundlesWorkbook_(root);
  seedBundlesIfPossible_(bundles.getId());

  const summary = {
    ROOT_FOLDER_ID: root.getId(),
    ROSTER_SHEET_ID: roster.getId(),
    PROJECTS_SHEET_ID: projects.getId(),
    BUNDLES_SHEET_ID: bundles.getId(),
  };

  console.log('=== Paste these into 00_config.js, then `clasp push` ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log('Roster workbook URL:    ' + roster.getUrl());
  console.log('Projects workbook URL:  ' + projects.getUrl());
  console.log('Bundles workbook URL:   ' + bundles.getUrl());
  console.log('Root folder URL:        ' + root.getUrl());
  return summary;
}

function bootstrapRootFolder_() {
  if (CONFIG.ROOT_FOLDER_ID) return DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);
  const driveRoot = DriveApp.getRootFolder();
  return findChildFolder_(driveRoot, NAMES.ROOT_FOLDER) || driveRoot.createFolder(NAMES.ROOT_FOLDER);
}

function bootstrapRosterWorkbook_(root) {
  if (CONFIG.ROSTER_SHEET_ID) return SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  let file = findChildFile_(root, NAMES.ROSTER_WORKBOOK);
  let ss;
  if (file) {
    ss = SpreadsheetApp.openById(file.getId());
  } else {
    ss = SpreadsheetApp.create(NAMES.ROSTER_WORKBOOK);
    moveFileToFolder_(ss.getId(), root);
  }
  ensureSingleTabRenamedAndHeaders_(ss, TABS.ROSTER, HEADERS.ROSTER);
  ensureTabWithHeaders_(ss, TABS.STAFF, HEADERS.STAFF);
  return DriveApp.getFileById(ss.getId());
}

function bootstrapProjectsWorkbook_(root) {
  if (CONFIG.PROJECTS_SHEET_ID) return SpreadsheetApp.openById(CONFIG.PROJECTS_SHEET_ID);
  let file = findChildFile_(root, NAMES.PROJECTS_WORKBOOK);
  let ss;
  if (file) {
    ss = SpreadsheetApp.openById(file.getId());
  } else {
    ss = SpreadsheetApp.create(NAMES.PROJECTS_WORKBOOK);
    moveFileToFolder_(ss.getId(), root);
  }
  ensureSingleTabRenamedAndHeaders_(ss, TABS.PROJECTS, HEADERS.PROJECTS);
  return DriveApp.getFileById(ss.getId());
}

function bootstrapBundlesWorkbook_(root) {
  if (CONFIG.BUNDLES_SHEET_ID) return SpreadsheetApp.openById(CONFIG.BUNDLES_SHEET_ID);
  let file = findChildFile_(root, NAMES.BUNDLES_WORKBOOK);
  let ss;
  if (file) {
    ss = SpreadsheetApp.openById(file.getId());
  } else {
    ss = SpreadsheetApp.create(NAMES.BUNDLES_WORKBOOK);
    moveFileToFolder_(ss.getId(), root);
  }
  ensureSingleTabRenamedAndHeaders_(ss, TABS.BUNDLES, HEADERS.BUNDLES);
  return DriveApp.getFileById(ss.getId());
}

/** Seed History Day bundle. Safe to call regardless of whether CONFIG has the ID. */
function seedBundlesIfPossible_(bundlesId) {
  const prev = CONFIG.BUNDLES_SHEET_ID;
  CONFIG.BUNDLES_SHEET_ID = bundlesId; // temporary, so listBundles_/createBundle_ work
  try {
    seedHistoryDayBundleIfMissing_();
  } finally {
    CONFIG.BUNDLES_SHEET_ID = prev;
  }
}

function moveFileToFolder_(fileId, folder) {
  const f = DriveApp.getFileById(fileId);
  folder.addFile(f);
  DriveApp.getRootFolder().removeFile(f);
}

function ensureSingleTabRenamedAndHeaders_(ss, tabName, headers) {
  const sheets = ss.getSheets();
  let tab = ss.getSheetByName(tabName);
  if (!tab) {
    if (sheets.length === 1 && sheets[0].getName() === 'Sheet1' && sheets[0].getLastRow() === 0) {
      sheets[0].setName(tabName);
      tab = sheets[0];
    } else {
      tab = ss.insertSheet(tabName);
    }
  }
  ensureHeaders_(tab, headers);
}

function ensureTabWithHeaders_(ss, tabName, headers) {
  let tab = ss.getSheetByName(tabName);
  if (!tab) tab = ss.insertSheet(tabName);
  ensureHeaders_(tab, headers);
}
