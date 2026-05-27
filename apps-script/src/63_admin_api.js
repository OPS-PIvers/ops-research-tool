/**
 * Admin-only endpoints called from the Console via google.script.run.
 * All endpoints assertAdmin_() first; non-admin staff and non-staff
 * users are both rejected at the server, regardless of UI gating.
 *
 * This file grows over the sub-project. Order roughly: roster reads,
 * roster mutations, staff mutations, archive-year operations.
 */

/**
 * Full roster read with hasWork precomputation.
 *
 * hasWork[email] = true iff there exists a Sheet file named `<email>`
 * inside any class folder under any project root (active OR archived).
 *
 * Implementation: one Drive walk per call. For ~10 projects × ~5
 * classes × ~25 students that's ~1500 Drive items — handled in a few
 * seconds. The result is used to decide whether to require a
 * typed-confirm modal for row delete (Section 7.2 of spec).
 */
function adminGetRoster() {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const rows = readAllAsObjects_(getTab_(ss, TABS.ROSTER), HEADERS.ROSTER);
  const workEmails = listAllStudentSheetEmails_();
  return {
    ok: true,
    rows: rows.map((r) => ({
      ID: String(r.ID || ''),
      First: String(r.First || ''),
      Last: String(r.Last || ''),
      Email: String(r.Email || '').toLowerCase(),
      Class: String(r.Class || ''),
      Teacher: String(r.Teacher || ''),
      TeacherEmail: String(r.TeacherEmail || '').toLowerCase(),
      hasWork: workEmails[String(r.Email || '').toLowerCase()] === true,
    })),
  };
}

/**
 * Build a {emailLower: true} map of every email that names a per-student
 * Sheet in any project's class folder. Walks Drive once.
 *
 * Returns the map (object) for O(1) lookups during the roster
 * enrichment pass in adminGetRoster.
 */
function listAllStudentSheetEmails_() {
  const out = {};
  const root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);

  // Active project folders live under root. Archived ones live under
  // root/Archived/. We walk both.
  const projectFolders = [];
  const directKids = root.getFolders();
  while (directKids.hasNext()) {
    const f = directKids.next();
    if (f.getName() === NAMES.ARCHIVED_FOLDER) {
      const archivedKids = f.getFolders();
      while (archivedKids.hasNext()) projectFolders.push(archivedKids.next());
    } else {
      projectFolders.push(f);
    }
  }

  projectFolders.forEach((pf) => {
    const classFolders = pf.getFolders();
    while (classFolders.hasNext()) {
      const cf = classFolders.next();
      const files = cf.getFiles();
      while (files.hasNext()) {
        const fl = files.next();
        const name = fl.getName().toLowerCase();
        // Per-student Sheets are named exactly `[email]`. Cheap filter:
        // anything with an @ and a dot is plausibly an email.
        if (name.indexOf('@') > 0 && name.indexOf('.') > 0) {
          out[name] = true;
        }
      }
    }
  });

  return out;
}
