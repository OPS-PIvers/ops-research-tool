# Admin Area + Lifecycle Implementation Plan (Phase 4 — Sub-project C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the admin-only surfaces to the existing Teacher Console — roster CRUD + bulk replace (with a 4→7 column schema migration), staff CRUD with last-admin guard, bulk Archive School Year (status flip + Drive folder move + stale-pref clear), and a server-side audit log feeding a 7-day "recently unarchived" banner on the Project Dashboard.

**Architecture:** Three new server modules (`63_admin_api.js`, `64_audit.js`, `65_lifecycle.js`) and one new client JS partial (`admin_js.html`) included alongside `console_js.html`. SPA navigation continues to work via hash routes under `#/admin/*`. All `admin*` endpoints gated by a new `assertAdmin_(actorEmail)` helper. Audit log lives as a new `Audit` tab on the Projects registry workbook.

**Tech Stack:** Apps Script V8 runtime · Google Workspace Sheets storage · HtmlService templates · vanilla JS in HTML files (no bundler) · `google.script.run` for client→server · `PropertiesService.getScriptProperties()` for user prefs · `localStorage` for client-side banner dismissal.

**Repo:** `C:\dev\ops-research-tool` (Windows, PowerShell default; bash also available)
**GAS push command** (refresh PATH first per `CLAUDE.md` §8): `cd C:\dev\ops-research-tool\apps-script; clasp push -f`
**Project ID:** `1IFhm0FJNiXSeDKGS8VnDfkhs8VY6ueWmHIvc6CIda1AcFXrh1skow2E3`
**Spec:** `docs/superpowers/specs/2026-05-27-admin-area-lifecycle-design.md`
**Branch:** `feature/admin-area-lifecycle` (already created at commit `4c41742` containing just the spec)

**Subagent model guidance:** Use **Haiku** for purely mechanical tasks (Task 1's HEADERS bump, Task 2's constants additions). Use **Sonnet** for tasks involving new endpoint logic, schema-aware code paths, atomic operations, UI state, or dev-test design (everything else).

---

## File Structure (final state)

After this plan completes:

```
apps-script/src/
  02_constants.js           ← MODIFIED: HEADERS.ROSTER → 7-col; +HEADERS.AUDIT; +AUDIT_ACTIONS
  10_identity.js            ← MODIFIED: +assertAdmin_; validateRoster updated for 7-col
  11_provisioning.js        ← MODIFIED: Meta-row populates from First/Last/Teacher
  12_projects.js            ← MODIFIED: archive/unarchive helpers refactored to delegate
  61_console_api.js         ← MODIFIED: listClassesTaughtBy_ on TeacherEmail;
                                consoleArchiveProject + consoleUnarchiveProject
                                extended (Drive move + prefs + audit);
                                consoleGetProjectDashboard returns recentUnarchive
  63_admin_api.js           ← NEW: all admin* endpoints
  64_audit.js               ← NEW: appendAuditEvent_, latestUnarchiveFor_, ensureAuditTab_
  65_lifecycle.js           ← NEW: flipProjectStatus_, moveProjectToArchived_,
                                restoreProjectFromArchived_, clearStaleActiveProjectPrefs_,
                                archiveSchoolYear_
  console.html              ← MODIFIED: +<?!= includeFile_('admin_js') ?>
  console_js.html           ← MODIFIED: Admin ▾ dropdown; #/admin/* routes;
                                renderView_ delegates ADMIN_* to admin_js;
                                renderDashboard_ shows recentUnarchive banner
  console_css.html          ← MODIFIED: +admin tables, typed-confirm modal,
                                banner, import dialog styles
  admin_js.html             ← NEW: ADMIN_ROSTER, ADMIN_STAFF, ADMIN_LIFECYCLE views
                                + shared typedConfirmModal_() helper + import dialog
  99_dev.js                 ← MODIFIED: +5 devTest* functions for sub-project C
```

No changes to: `00_config.js`, `01_setup.js`, `03_utils.js`, `04_user_prefs.js`, `13_bundles.js`, `20_writes.js`, `21_reads.js`, `30_endpoints.js`, `40_seed_history_day.js`, `50_docs_addon.js`, `51_citation.js`, `52_bibliography.js`, `53_sidebar_api.js`, `60_console_routing.js`, `62_aggregator.js`, `sidebar.html`, `sidebar_js.html`, `sidebar_css.html`, `source_editor.html`, `source_editor_js.html`, `extension/**`.

---

## Pre-flight (do once)

- [ ] **P1: Confirm on the right branch with a clean tree**

```powershell
cd C:\dev\ops-research-tool
git status
git log -1 --oneline
```

Expected: working tree clean, `On branch feature/admin-area-lifecycle`, head at `4c41742 spec(admin): ...` (or later if more work has landed).

- [ ] **P2: Confirm clasp works**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\dev\ops-research-tool\apps-script
clasp status
```

Expected: lists `src/02_constants.js`, `src/10_identity.js`, `src/61_console_api.js`, `src/99_dev.js`, etc. No errors.

- [ ] **P3: Confirm existing dev tests pass**

In the GAS editor (https://script.google.com/d/1IFhm0FJNiXSeDKGS8VnDfkhs8VY6ueWmHIvc6CIda1AcFXrh1skow2E3/edit):
- Run `devTestNormalizeUrl` → expect `8/8 passed`.
- Run `devTestRoundTrip` → expect no errors.
- Run `devTestConsoleAuth` → expect all checks pass.

Do not proceed if any fails — sub-project C builds directly on these.

- [ ] **P4: Roster + Staff are in a known-good state**

Open the Roster workbook (`17vs9bb7oFoiT_D7Z4z2vQfLzWyEpLMd21ZWUDovSvEs`). Confirm:
- `Roster` tab exists with the legacy 4-column header `Name | Email | Class | Teacher`.
- `Staff` tab exists with `Name | Email | Role`.
- At least one row in `Staff` has `Role = admin` (otherwise sub-project C's admin endpoints will all reject).

Task 1 will migrate the Roster header in place; ensure the workbook is the live one before proceeding.

---

## Task 1: Roster schema migration (4 → 7 columns)

**Model:** Sonnet — schema change with rippled effects in multiple files.

**Files:**
- Modify: `apps-script/src/02_constants.js` (the `HEADERS.ROSTER` array)
- Modify: `apps-script/src/10_identity.js` (`validateRoster`)
- Modify: `apps-script/src/11_provisioning.js` (`findOrCreateStudentSheet_`)
- Modify: `apps-script/src/61_console_api.js` (`listClassesTaughtBy_`)
- Modify (Roster workbook): the header row of the `Roster` tab.

Per spec §6. The cutover is "re-paste the roster in the new 7-column shape via the bulk import flow once that ships" (Task 14). For this task we just update the code so subsequent tasks compile and the bulk-import endpoints can rewrite the tab.

- [ ] **Step 1: Update `HEADERS.ROSTER` in `02_constants.js`**

Open `apps-script/src/02_constants.js`. Replace the existing `ROSTER` entry (currently `['Name', 'Email', 'Class', 'Teacher']`) inside the `HEADERS` object with:

```javascript
  ROSTER: ['ID', 'First', 'Last', 'Email', 'Class', 'Teacher', 'TeacherEmail'],
```

Leave `HEADERS.STAFF` unchanged.

- [ ] **Step 2: Update `validateRoster` in `10_identity.js`**

In `apps-script/src/10_identity.js`, replace the `validateRoster()` function with this version that checks the 7-col schema:

```javascript
function validateRoster() {
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const roster = readAllAsObjects_(getTab_(ss, TABS.ROSTER), HEADERS.ROSTER);
  const staff = readAllAsObjects_(getTab_(ss, TABS.STAFF), HEADERS.STAFF);
  const errors = [];
  const emailSeen = new Set();
  const idSeen = new Set();
  roster.forEach((r, i) => {
    const rowNum = i + 2;
    if (!r.Email) errors.push(`Roster row ${rowNum}: blank Email`);
    if (!r.First) errors.push(`Roster row ${rowNum}: blank First`);
    if (!r.Last)  errors.push(`Roster row ${rowNum}: blank Last`);
    if (!r.Class) errors.push(`Roster row ${rowNum}: blank Class`);
    if (!r.TeacherEmail) errors.push(`Roster row ${rowNum}: blank TeacherEmail`);
    const e = String(r.Email || '').toLowerCase();
    if (e && emailSeen.has(e)) errors.push(`Roster row ${rowNum}: duplicate Email ${e}`);
    emailSeen.add(e);
    const id = String(r.ID || '').trim();
    if (id) {
      if (idSeen.has(id)) errors.push(`Roster row ${rowNum}: duplicate ID ${id}`);
      idSeen.add(id);
    }
  });
  const staffSeen = new Set();
  staff.forEach((r, i) => {
    const rowNum = i + 2;
    if (!r.Email) errors.push(`Staff row ${rowNum}: blank Email`);
    if (!r.Role)  errors.push(`Staff row ${rowNum}: blank Role`);
    if (r.Role && r.Role !== ROLES.TEACHER && r.Role !== ROLES.ADMIN) {
      errors.push(`Staff row ${rowNum}: bad Role "${r.Role}" (must be teacher|admin)`);
    }
    const e = String(r.Email || '').toLowerCase();
    if (e && staffSeen.has(e)) errors.push(`Staff row ${rowNum}: duplicate Email ${e}`);
    staffSeen.add(e);
  });
  const result = { ok: errors.length === 0, errors, rosterCount: roster.length, staffCount: staff.length };
  console.log(JSON.stringify(result, null, 2));
  return result;
}
```

- [ ] **Step 3: Update `findOrCreateStudentSheet_` Meta population in `11_provisioning.js`**

In `apps-script/src/11_provisioning.js`, locate the `appendRow_(getTab_(ss, TABS.META), HEADERS.META, {...})` call inside `findOrCreateStudentSheet_`. Replace it with:

```javascript
  // Populate Meta (single row) — names composed from First/Last; teacher
  // is the display string (TeacherEmail is the join key, kept in roster).
  appendRow_(getTab_(ss, TABS.META), HEADERS.META, {
    studentName: (String(rosterEntry.Last || '') + ', ' + String(rosterEntry.First || '')).replace(/^, |, $/g, ''),
    studentEmail: actorEmail,
    class: rosterEntry.Class,
    teacher: rosterEntry.Teacher || rosterEntry.TeacherEmail || '',
    projectId: project.projectId,
    groupId: '',
  });
```

The `.replace(/^, |, $/g, '')` trims a stray leading/trailing comma+space when either First or Last is blank (defensive — `validateRoster` rejects that case but Meta is written before validation runs).

- [ ] **Step 4: Update `listClassesTaughtBy_` in `61_console_api.js`**

In `apps-script/src/61_console_api.js`, replace the existing `listClassesTaughtBy_` function with:

```javascript
/**
 * Classes whose TeacherEmail column equals this email in the Roster.
 * Distinct, trimmed, non-empty. Returns [] if the actor teaches nothing.
 */
function listClassesTaughtBy_(actorEmail) {
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const rows = readAllAsObjects_(getTab_(ss, TABS.ROSTER), HEADERS.ROSTER);
  const set = {};
  rows.forEach((r) => {
    if (r.TeacherEmail && String(r.TeacherEmail).trim().toLowerCase() === actorEmail.toLowerCase()) {
      const cls = String(r.Class || '').trim();
      if (cls) set[cls] = true;
    }
  });
  return Object.keys(set).sort();
}
```

- [ ] **Step 5: Update the Roster tab's header row in the workbook**

Open the Roster workbook (`17vs9bb7oFoiT_D7Z4z2vQfLzWyEpLMd21ZWUDovSvEs`) → `Roster` tab. Replace row 1 cells A1..G1 with:

```
ID    First    Last    Email    Class    Teacher    TeacherEmail
```

The existing data rows (in the legacy `Name | Email | Class | Teacher` shape) will be **wrong** after this header change — that's expected. Task 14 (`adminReplaceRoster`) will let the admin re-paste fresh data. For development, you can also manually re-key one or two rows by hand for `validateRoster` / `consoleGetMyProjects` to keep working.

- [ ] **Step 6: Push and confirm**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

In the GAS editor, run `validateRoster()`. Expected: `ok: false` with errors that reference the new column names (`blank First`, `blank Last`, `blank TeacherEmail`) — confirming the new validator is running. (If you migrated rows by hand in Step 5, expect `ok: true`.)

- [ ] **Step 7: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/02_constants.js apps-script/src/10_identity.js apps-script/src/11_provisioning.js apps-script/src/61_console_api.js
git commit -m "feat(roster): migrate HEADERS.ROSTER to 7 columns (ID/First/Last/Email/Class/Teacher/TeacherEmail)`n`nlistClassesTaughtBy_ now joins on TeacherEmail (Teacher becomes a display-only column). Meta tab studentName composed from 'Last, First'. validateRoster checks the new shape plus optional-but-unique ID."
```

---

## Task 2: Audit constants + `assertAdmin_` helper

**Model:** Haiku — mechanical additions.

**Files:**
- Modify: `apps-script/src/02_constants.js` (`HEADERS.AUDIT`, `AUDIT_ACTIONS`, `TABS.AUDIT`)
- Modify: `apps-script/src/10_identity.js` (`assertAdmin_`)

- [ ] **Step 1: Add `TABS.AUDIT` to `02_constants.js`**

In `apps-script/src/02_constants.js`, add `AUDIT: 'Audit'` to the `TABS` object so it reads:

```javascript
const TABS = {
  ROSTER: 'Roster',
  STAFF: 'Staff',
  PROJECTS: 'Projects',
  BUNDLES: 'Bundles',
  META: 'Meta',
  SOURCES: 'Sources',
  HIGHLIGHTS: 'Highlights',
  AUDIT: 'Audit',
};
```

- [ ] **Step 2: Add `HEADERS.AUDIT` to `02_constants.js`**

Inside the same `HEADERS` object (still in `02_constants.js`), after `HIGHLIGHTS`, add:

```javascript
  AUDIT: ['eventId', 'projectId', 'action', 'actor', 'at', 'detail'],
```

- [ ] **Step 3: Add `AUDIT_ACTIONS` enum to `02_constants.js`**

At the bottom of `02_constants.js`, after the existing const blocks, add:

```javascript
const AUDIT_ACTIONS = {
  ARCHIVE: 'archive',
  UNARCHIVE: 'unarchive',
  ARCHIVE_YEAR: 'archive_year',
};
```

- [ ] **Step 4: Add `assertAdmin_` helper to `10_identity.js`**

In `apps-script/src/10_identity.js`, append after the existing `isAdmin_` function (do not remove `isAdmin_`; it's still used by Phase 4 A+B code):

```javascript
/**
 * Throws 'Not authorized' if the caller isn't on Staff at all, or
 * 'Admin only' if the caller is staff but not an admin. Returns the
 * staff entry so callers can read .Email / .Name without re-fetching.
 *
 * The two error messages are deliberately distinct so the client toast
 * can communicate "you're not staff at all" vs. "you're a teacher,
 * this surface is admin-only".
 */
function assertAdmin_(actorEmail) {
  const staff = getStaffEntry_(actorEmail);
  if (!staff) throw new Error('Not authorized');
  if (staff.Role !== ROLES.ADMIN) throw new Error('Admin only');
  return staff;
}
```

- [ ] **Step 5: Push and confirm**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

In the GAS editor, paste the following in a scratch file (or the bottom of `99_dev.js`) and Run:

```javascript
function _devProbeAssertAdmin() {
  try { assertAdmin_('nobody@orono.k12.mn.us'); console.log('FAIL: did not throw'); }
  catch (e) { console.log('non-staff threw:', e.message); }
  try { assertAdmin_('paul.ivers@orono.k12.mn.us'); console.log('admin returned: ok'); }
  catch (e) { console.log('FAIL admin throw:', e.message); }
}
```

Expected log: `non-staff threw: Not authorized`, then `admin returned: ok`. Remove the probe function after.

- [ ] **Step 6: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/02_constants.js apps-script/src/10_identity.js
git commit -m "feat(admin): add audit constants and assertAdmin_ helper`n`nHEADERS.AUDIT, AUDIT_ACTIONS, TABS.AUDIT for the new Audit tab on the Projects registry. assertAdmin_ wraps getStaffEntry_ + role check; throws 'Not authorized' for non-staff and 'Admin only' for teachers, so toasts can distinguish."
```

---

## Task 3: Audit log module (`64_audit.js`)

**Model:** Sonnet — new module + behavior to keep honest.

**Files:**
- Create: `apps-script/src/64_audit.js`

Pure read/write over the `Audit` tab on the Projects registry workbook. Lazy tab creation matches the patterns in `01_setup.js` / `ensureHeaders_`.

- [ ] **Step 1: Create `apps-script/src/64_audit.js`**

```javascript
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
  return event;
}

/**
 * Most recent unarchive event for a project, or null. Used by
 * consoleGetProjectDashboard to attach the "recently unarchived"
 * banner data (Section 10.3 of the spec).
 *
 * Full-tab scan — fine at the data volumes expected.
 */
function latestUnarchiveFor_(projectId) {
  if (!projectId) return null;
  const tab = ensureAuditTab_();
  const rows = readAllAsObjects_(tab, HEADERS.AUDIT);
  let latest = null;
  rows.forEach((r) => {
    if (r.projectId !== projectId) return;
    if (r.action !== AUDIT_ACTIONS.UNARCHIVE) return;
    if (latest === null || String(r.at || '') > String(latest.at || '')) latest = r;
  });
  return latest;
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
```

- [ ] **Step 2: Push and probe**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

In the GAS editor, paste this probe at the bottom of `99_dev.js` (will be removed at end of step):

```javascript
function _devProbeAudit() {
  const ev = appendAuditEvent_({
    projectId: 'probe-project',
    action: AUDIT_ACTIONS.UNARCHIVE,
    actor:  'paul.ivers@orono.k12.mn.us',
    detail: 'probe',
  });
  console.log('appended:', JSON.stringify(ev));
  const latest = latestUnarchiveFor_('probe-project');
  console.log('latest:', JSON.stringify(latest));
  // Cleanup: delete the row by hand from the Audit tab after observing.
}
```

Run `_devProbeAudit`. Expected log:
- `appended: {"eventId":"...","projectId":"probe-project","action":"unarchive","actor":"paul.ivers@orono.k12.mn.us","at":"...","detail":"probe"}`
- `latest: {"eventId":"...","projectId":"probe-project","action":"unarchive",...}`

Open the Projects registry workbook (`1FSCdO5zcnGhIr5Wdm4-YFSSIcjskWlivffm-ivkJvKE`) and confirm the new `Audit` tab exists with the header row + the probe row. Delete the probe row (right-click → delete row). Delete the `_devProbeAudit` function from `99_dev.js`.

- [ ] **Step 3: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/64_audit.js
git commit -m "feat(audit): add audit log module for project lifecycle events`n`nensureAuditTab_, appendAuditEvent_, latestUnarchiveFor_, listAuditEventsForProject_. Storage is a lazily-created Audit tab on the Projects registry. Full-scan reads are fine at expected volumes (<500 rows/year)."
```

---

## Task 4: Lifecycle helpers module (`65_lifecycle.js`)

**Model:** Sonnet — Drive moves + cross-cutting helpers; the Sheet/Drive mechanics need care.

**Files:**
- Create: `apps-script/src/65_lifecycle.js`

Helpers extracted so single-project archive and bulk-year archive share the same code path.

- [ ] **Step 1: Create `apps-script/src/65_lifecycle.js`**

```javascript
/**
 * Project lifecycle helpers — shared by single-project archive/unarchive
 * (consoleArchiveProject / consoleUnarchiveProject) and bulk archive
 * school year (adminArchiveSchoolYear).
 *
 * Three concerns combined here so caller code is uniform:
 *   1. Flip status cell on the Projects registry.
 *   2. Move the project's Drive folder under (or back from) Archived/.
 *   3. Clear any user_prefs activeProjectId that still points at the
 *      archived project (so students re-pick on next extension load
 *      instead of trying to write to an archived project and getting
 *      a 'refusing writes' error from doPost).
 */

/**
 * Set Projects.status for a project. Used by both archive and unarchive
 * paths (and by adminArchiveSchoolYear, which flips many at once).
 *
 * Replaces the in-place setValue logic that used to live in
 * archiveProject_ / unarchiveProject_ in 12_projects.js. Those wrappers
 * now delegate to this so the bulk path can share the code without
 * duplicating column-index math.
 */
function flipProjectStatus_(projectId, newStatus) {
  if (newStatus !== PROJECT_STATUS.ACTIVE && newStatus !== PROJECT_STATUS.ARCHIVED) {
    throw new Error('flipProjectStatus_: bad newStatus ' + newStatus);
  }
  const ss = SpreadsheetApp.openById(CONFIG.PROJECTS_SHEET_ID);
  const tab = getTab_(ss, TABS.PROJECTS);
  const rowIdx = findRowByKey_(tab, HEADERS.PROJECTS, 'projectId', projectId);
  if (rowIdx < 0) throw new Error('Unknown projectId ' + projectId);
  const statusCol = HEADERS.PROJECTS.indexOf('status') + 1;
  tab.getRange(rowIdx, statusCol).setValue(newStatus);
}

/**
 * Move a project's root folder under root/Archived/. Idempotent: if it's
 * already inside Archived/, this is a no-op. Find-or-creates the Archived
 * folder lazily.
 *
 * Implementation note: DriveApp's "move" is `addFolder` + `removeFolder`
 * on the parent. A folder can have multiple parents (shortcuts); we
 * normalize by ensuring exactly one (the Archived folder).
 */
function moveProjectToArchived_(projectFolderId) {
  const root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);
  const archived = findChildFolder_(root, NAMES.ARCHIVED_FOLDER) || root.createFolder(NAMES.ARCHIVED_FOLDER);
  const projectFolder = DriveApp.getFolderById(projectFolderId);

  // If already under Archived, no-op.
  const parents = projectFolder.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === archived.getId()) return;
  }

  // Add new parent, remove all other parents (covers root + any drift).
  archived.addFolder(projectFolder);
  const all = projectFolder.getParents();
  while (all.hasNext()) {
    const p = all.next();
    if (p.getId() !== archived.getId()) p.removeFolder(projectFolder);
  }
}

/**
 * Inverse of moveProjectToArchived_. Move the project folder back to
 * root. Idempotent: if it's already at root, no-op.
 */
function restoreProjectFromArchived_(projectFolderId) {
  const root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);
  const projectFolder = DriveApp.getFolderById(projectFolderId);

  const parents = projectFolder.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === root.getId()) return;
  }

  root.addFolder(projectFolder);
  const all = projectFolder.getParents();
  while (all.hasNext()) {
    const p = all.next();
    if (p.getId() !== root.getId()) p.removeFolder(projectFolder);
  }
}

/**
 * Walk ScriptProperties (where user prefs live; see 04_user_prefs.js for
 * key shape `prefs:<actorEmail>:activeProjectId`) and delete any
 * activeProjectId entry whose value equals `projectId`. Used by both
 * single-project and bulk archive paths.
 *
 * Returns the count of properties cleared.
 */
function clearStaleActiveProjectPrefs_(projectId) {
  if (!projectId) return 0;
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  let cleared = 0;
  Object.keys(all).forEach((key) => {
    if (!key.endsWith(':activeProjectId')) return;
    if (all[key] === projectId) {
      props.deleteProperty(key);
      cleared++;
    }
  });
  return cleared;
}

/**
 * The full per-project archive code path — used by both the single-project
 * console endpoint and the bulk-year endpoint.
 *
 * Steps:
 *   1. flipProjectStatus_(projectId, 'archived')
 *   2. moveProjectToArchived_(project.rootFolderId)
 *   3. clearStaleActiveProjectPrefs_(projectId)
 *   4. appendAuditEvent_({projectId, action, actor, detail})
 *
 * Errors at steps 2+ are caught and collected — once status is flipped
 * (cheap, atomic), the project is "archived" for all intents. Drive move
 * or pref clear failures are surfaced but do not roll back.
 *
 * Returns { ok, archived: bool, errors: [{step, error}] }.
 */
function archiveProjectFully_(projectId, action, actor, detail) {
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown projectId ' + projectId);
  if (project.status === PROJECT_STATUS.ARCHIVED) {
    return { ok: true, archived: false, errors: [] };  // idempotent skip
  }
  const errors = [];
  // Step 1 — status flip (cheap, must succeed)
  flipProjectStatus_(projectId, PROJECT_STATUS.ARCHIVED);
  // Step 2 — Drive move
  try { moveProjectToArchived_(project.rootFolderId); }
  catch (e) { errors.push({ step: 'moveFolder', error: String(e && e.message || e) }); }
  // Step 3 — pref clear
  try { clearStaleActiveProjectPrefs_(projectId); }
  catch (e) { errors.push({ step: 'clearPrefs', error: String(e && e.message || e) }); }
  // Step 4 — audit
  try { appendAuditEvent_({ projectId, action: action || AUDIT_ACTIONS.ARCHIVE, actor, detail: detail || '' }); }
  catch (e) { errors.push({ step: 'audit', error: String(e && e.message || e) }); }
  return { ok: true, archived: true, errors };
}

/**
 * The full per-project unarchive code path. Restores Drive folder, flips
 * status, audits. Does NOT restore previously-cleared activeProjectId
 * prefs (students re-select on next extension load).
 */
function unarchiveProjectFully_(projectId, actor, detail) {
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown projectId ' + projectId);
  if (project.status === PROJECT_STATUS.ACTIVE) {
    return { ok: true, unarchived: false, errors: [] };
  }
  const errors = [];
  flipProjectStatus_(projectId, PROJECT_STATUS.ACTIVE);
  try { restoreProjectFromArchived_(project.rootFolderId); }
  catch (e) { errors.push({ step: 'restoreFolder', error: String(e && e.message || e) }); }
  try { appendAuditEvent_({ projectId, action: AUDIT_ACTIONS.UNARCHIVE, actor, detail: detail || '' }); }
  catch (e) { errors.push({ step: 'audit', error: String(e && e.message || e) }); }
  return { ok: true, unarchived: true, errors };
}

/**
 * Bulk archive every active project with the given schoolYear.
 * Step 1 (status flip) happens for ALL first so the registry reflects
 * intent fast. Then steps 2-4 happen per project, errors collected.
 *
 * Returns { ok, schoolYear, archived: [projectId, ...], skipped: [], errors: [] }.
 * archived = projects whose status was flipped this call.
 * skipped  = projects already archived (no-op).
 * errors   = {projectId, step, error} entries from the move/prefs/audit steps.
 */
function archiveSchoolYear_(schoolYear, actor) {
  const all = listProjects_();
  const matches = all.filter((p) => p.schoolYear === schoolYear && p.status === PROJECT_STATUS.ACTIVE);
  const skipped = all.filter((p) => p.schoolYear === schoolYear && p.status === PROJECT_STATUS.ARCHIVED).map((p) => p.projectId);

  // Phase A — flip status for every match first.
  matches.forEach((p) => flipProjectStatus_(p.projectId, PROJECT_STATUS.ARCHIVED));

  // Phase B — Drive moves + prefs + audit per project.
  const errors = [];
  matches.forEach((p) => {
    try { moveProjectToArchived_(p.rootFolderId); }
    catch (e) { errors.push({ projectId: p.projectId, step: 'moveFolder', error: String(e && e.message || e) }); }
    try { clearStaleActiveProjectPrefs_(p.projectId); }
    catch (e) { errors.push({ projectId: p.projectId, step: 'clearPrefs', error: String(e && e.message || e) }); }
    try {
      appendAuditEvent_({
        projectId: p.projectId,
        action: AUDIT_ACTIONS.ARCHIVE_YEAR,
        actor,
        detail: 'schoolYear=' + schoolYear,
      });
    } catch (e) { errors.push({ projectId: p.projectId, step: 'audit', error: String(e && e.message || e) }); }
  });

  return {
    ok: true,
    schoolYear,
    archived: matches.map((p) => p.projectId),
    skipped,
    errors,
  };
}
```

- [ ] **Step 2: Push and confirm**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

No probe needed at this step — the helpers will be exercised by Task 5's refactored `consoleArchiveProject` and by Task 12's dev test. Confirm push succeeded by reloading the GAS editor and observing that `65_lifecycle.js` appears in the file tree.

- [ ] **Step 3: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/65_lifecycle.js
git commit -m "feat(lifecycle): add shared archive/unarchive helpers (65_lifecycle.js)`n`nflipProjectStatus_, moveProjectToArchived_, restoreProjectFromArchived_, clearStaleActiveProjectPrefs_, archiveProjectFully_, unarchiveProjectFully_, archiveSchoolYear_. Single-project and bulk-year paths now share one implementation."
```

---

## Task 5: Refactor `12_projects.js` + extend single-project archive endpoints

**Model:** Sonnet — behavior change to existing console endpoints.

**Files:**
- Modify: `apps-script/src/12_projects.js` (collapse `archiveProject_`, `unarchiveProject_` into thin wrappers)
- Modify: `apps-script/src/61_console_api.js` (`consoleArchiveProject`, `consoleUnarchiveProject` now do the full flow)

- [ ] **Step 1: Refactor `archiveProject_` and `unarchiveProject_` in `12_projects.js`**

In `apps-script/src/12_projects.js`, replace the existing `archiveProject_` and `unarchiveProject_` functions with these thin wrappers that delegate to `flipProjectStatus_`:

```javascript
function archiveProject_(projectId) {
  flipProjectStatus_(projectId, PROJECT_STATUS.ARCHIVED);
}

function unarchiveProject_(projectId) {
  flipProjectStatus_(projectId, PROJECT_STATUS.ACTIVE);
}
```

These keep the existing function names alive (other callers may exist; e.g., the dev tests in `99_dev.js`) while delegating to the lifecycle module. The full archive/unarchive flow (Drive move + prefs + audit) lives in `archiveProjectFully_` / `unarchiveProjectFully_` and is called from the console endpoints, not from these.

- [ ] **Step 2: Extend `consoleArchiveProject` in `61_console_api.js`**

In `apps-script/src/61_console_api.js`, replace `consoleArchiveProject` (currently at line 194) with:

```javascript
/**
 * Flip a project's status to archived, move its Drive folder under
 * Archived/, clear any stale activeProjectId prefs, and write an audit
 * event. Anyone on staff can archive any project (authorization is by
 * staff role, not project ownership — both admins and teachers).
 */
function consoleArchiveProject(projectId) {
  const actorEmail = getActorEmail_();
  assertStaff_(actorEmail);
  if (!projectId) throw new Error('projectId required');
  const result = archiveProjectFully_(projectId, AUDIT_ACTIONS.ARCHIVE, actorEmail, '');
  return { ok: true, projectId, errors: result.errors };
}
```

- [ ] **Step 3: Extend `consoleUnarchiveProject` in `61_console_api.js`**

Immediately below, replace `consoleUnarchiveProject` with:

```javascript
function consoleUnarchiveProject(projectId) {
  const actorEmail = getActorEmail_();
  assertStaff_(actorEmail);
  if (!projectId) throw new Error('projectId required');
  const result = unarchiveProjectFully_(projectId, actorEmail, '');
  return { ok: true, projectId, errors: result.errors };
}
```

- [ ] **Step 4: Push and run the existing archive dev test**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

In the GAS editor, run `devTestConsoleDashboardEndToEnd` (existing test from Phase 4 A+B). It should still pass — the refactor preserves observable behavior. If it fails, do not proceed; debug the lifecycle module.

Also run `devTestConsoleCreateProject` — it calls `consoleArchiveProject` at the end of its cleanup, so it exercises the new code path. Expected: all checks pass.

After running the test, manually inspect the Drive root:
- A test project folder should have been moved into `OPS Research Tool/Archived/`.
- The Audit tab on the Projects registry should have at least one new `archive` row.

If both look right, proceed. Cleanup: move the test folder back out of Archived by hand, delete the test Audit row.

- [ ] **Step 5: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/12_projects.js apps-script/src/61_console_api.js
git commit -m "feat(console): single-project archive/unarchive moves folder + audits`n`nconsoleArchiveProject and consoleUnarchiveProject now call the shared full-flow helpers (Drive folder move, stale activeProjectId clear, audit log append). 12_projects.js archiveProject_/unarchiveProject_ collapse to thin wrappers around flipProjectStatus_."
```

---

## Task 6: Admin roster read endpoint + `hasWork` precompute

**Model:** Sonnet — `hasWork` design needs care; one Drive walk per page load.

**Files:**
- Create: `apps-script/src/63_admin_api.js` (with `adminGetRoster` and the `hasWork` helper)

This task seeds `63_admin_api.js`. Subsequent tasks (7-11) append more endpoints to the same file.

- [ ] **Step 1: Create `apps-script/src/63_admin_api.js` with `adminGetRoster` + helper**

```javascript
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
```

- [ ] **Step 2: Push and probe**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

In the GAS editor, paste a probe at the bottom of `99_dev.js`:

```javascript
function _devProbeAdminGetRoster() {
  const r = adminGetRoster();
  console.log('count:', r.rows.length);
  console.log('first 3:', JSON.stringify(r.rows.slice(0, 3), null, 2));
  const withWork = r.rows.filter((x) => x.hasWork);
  console.log('hasWork count:', withWork.length);
}
```

Run `_devProbeAdminGetRoster`. Expected: prints row count, three sample rows in the new 7-col shape, and a count of rows whose email matches a per-student Sheet (likely just the dev row from `devSeedDevProject`). Delete the probe.

- [ ] **Step 3: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/63_admin_api.js
git commit -m "feat(admin): add adminGetRoster with hasWork precompute`n`nWalks Drive once per call to identify which emails name a per-student Sheet (in active or archived projects). Used by the client to decide whether row delete needs a typed-confirm modal."
```

---

## Task 7: Admin roster mutation endpoints

**Model:** Sonnet — each endpoint is small but together they need consistent shape + validation.

**Files:**
- Modify: `apps-script/src/63_admin_api.js` (append `adminAddRosterRow`, `adminUpdateRosterRow`, `adminSetStudentId`, `adminChangeStudentId`, `adminDeleteRosterRow`)

- [ ] **Step 1: Append roster mutation endpoints to `63_admin_api.js`**

At the bottom of `apps-script/src/63_admin_api.js`, append:

```javascript
// ============================================================
// Roster mutations
// ============================================================

/**
 * Add a new roster row. Validates required fields, email uniqueness
 * (case-insensitive), and ID uniqueness (if provided).
 *
 * `row` shape (input): {ID?, First, Last, Email, Class, Teacher?, TeacherEmail?}
 * Returns { ok, row } with the canonicalized stored values.
 */
function adminAddRosterRow(row) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!row) throw new Error('row required');
  const out = canonicalizeRosterRow_(row, /*requireEmail=*/true);
  validateRosterRowOrThrow_(out);
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.ROSTER);
  const all = readAllAsObjects_(tab, HEADERS.ROSTER);
  if (all.some((r) => String(r.Email || '').toLowerCase() === out.Email)) {
    throw new Error('Email already in roster: ' + out.Email);
  }
  if (out.ID && all.some((r) => String(r.ID || '').trim() === out.ID)) {
    throw new Error('ID already in roster: ' + out.ID);
  }
  appendRow_(tab, HEADERS.ROSTER, out);
  return { ok: true, row: out };
}

/**
 * Update an existing roster row, identified by Email. Accepts any subset
 * of {First, Last, Class, Teacher, TeacherEmail}. Email and ID are
 * deliberately NOT accepted here — they go through dedicated endpoints.
 */
function adminUpdateRosterRow(email, fields) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!email) throw new Error('email required');
  if (!fields) throw new Error('fields required');
  const target = String(email).toLowerCase();
  const allowed = ['First', 'Last', 'Class', 'Teacher', 'TeacherEmail'];
  const updates = {};
  Object.keys(fields).forEach((k) => {
    if (allowed.indexOf(k) >= 0) updates[k] = String(fields[k] || '');
  });
  if (Object.keys(updates).length === 0) throw new Error('No editable fields supplied');
  if ('TeacherEmail' in updates) updates.TeacherEmail = updates.TeacherEmail.toLowerCase();

  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.ROSTER);
  const rowIdx = findRowByKeyCi_(tab, HEADERS.ROSTER, 'Email', target);
  if (rowIdx < 0) throw new Error('Roster row not found: ' + target);
  HEADERS.ROSTER.forEach((header, i) => {
    if (header in updates) tab.getRange(rowIdx, i + 1).setValue(updates[header]);
  });
  // Read back the canonical row.
  const updatedObjects = readAllAsObjects_(tab, HEADERS.ROSTER);
  const updated = updatedObjects.find((r) => String(r.Email || '').toLowerCase() === target);
  return { ok: true, row: updated };
}

/**
 * Set the ID on a roster row that doesn't have one yet. Throws if already set.
 */
function adminSetStudentId(email, id) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!email) throw new Error('email required');
  if (!id)    throw new Error('id required');
  const target = String(email).toLowerCase();
  const trimmedId = String(id).trim();
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.ROSTER);
  const all = readAllAsObjects_(tab, HEADERS.ROSTER);
  const target_row = all.find((r) => String(r.Email || '').toLowerCase() === target);
  if (!target_row) throw new Error('Roster row not found: ' + target);
  if (String(target_row.ID || '').trim()) throw new Error('ID already set for ' + target);
  if (all.some((r) => String(r.ID || '').trim() === trimmedId)) {
    throw new Error('ID already in roster: ' + trimmedId);
  }
  const rowIdx = findRowByKeyCi_(tab, HEADERS.ROSTER, 'Email', target);
  const idCol = HEADERS.ROSTER.indexOf('ID') + 1;
  tab.getRange(rowIdx, idCol).setValue(trimmedId);
  return { ok: true, row: Object.assign({}, target_row, { ID: trimmedId }) };
}

/**
 * Change an already-set ID. Typed-confirm gated client-side. Server
 * validates uniqueness.
 */
function adminChangeStudentId(email, newId) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!email) throw new Error('email required');
  if (!newId) throw new Error('newId required');
  const target = String(email).toLowerCase();
  const trimmedId = String(newId).trim();
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.ROSTER);
  const all = readAllAsObjects_(tab, HEADERS.ROSTER);
  const target_row = all.find((r) => String(r.Email || '').toLowerCase() === target);
  if (!target_row) throw new Error('Roster row not found: ' + target);
  if (!String(target_row.ID || '').trim()) {
    throw new Error('No ID set — use adminSetStudentId to add one');
  }
  if (all.some((r) =>
        String(r.Email || '').toLowerCase() !== target &&
        String(r.ID || '').trim() === trimmedId)) {
    throw new Error('ID already in roster: ' + trimmedId);
  }
  const rowIdx = findRowByKeyCi_(tab, HEADERS.ROSTER, 'Email', target);
  const idCol = HEADERS.ROSTER.indexOf('ID') + 1;
  tab.getRange(rowIdx, idCol).setValue(trimmedId);
  return { ok: true, row: Object.assign({}, target_row, { ID: trimmedId }) };
}

/**
 * Delete a roster row. Per-student Sheets are PRESERVED — data persists
 * even after roster removal (per build-plan §Lifecycle). Returns the
 * list of project Sheets that survive.
 */
function adminDeleteRosterRow(email) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!email) throw new Error('email required');
  const target = String(email).toLowerCase();
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.ROSTER);
  const rowIdx = findRowByKeyCi_(tab, HEADERS.ROSTER, 'Email', target);
  if (rowIdx < 0) throw new Error('Roster row not found: ' + target);

  // Identify preserved per-student Sheets so the response can surface them.
  const preserved = findStudentSheetsForEmail_(target);

  // Delete the row (Sheets API uses 1-based row indices).
  tab.deleteRow(rowIdx);
  return { ok: true, email: target, preservedSheets: preserved };
}

// ============================================================
// Shared helpers (private to this file)
// ============================================================

/**
 * Build a canonical roster row object. Lowercases emails, trims strings.
 * `requireEmail` makes Email mandatory (true on Add; false reserved for
 * bulk-import preview where rows with blank emails surface as errors,
 * not exceptions).
 */
function canonicalizeRosterRow_(row, requireEmail) {
  const out = {
    ID:           String(row.ID || '').trim(),
    First:        String(row.First || '').trim(),
    Last:         String(row.Last || '').trim(),
    Email:        String(row.Email || '').trim().toLowerCase(),
    Class:        String(row.Class || '').trim(),
    Teacher:      String(row.Teacher || '').trim(),
    TeacherEmail: String(row.TeacherEmail || '').trim().toLowerCase(),
  };
  if (requireEmail && !out.Email) throw new Error('Email required');
  return out;
}

function validateRosterRowOrThrow_(row) {
  if (!row.First) throw new Error('First required');
  if (!row.Last)  throw new Error('Last required');
  if (!row.Email) throw new Error('Email required');
  if (!row.Class) throw new Error('Class required');
  if (!row.TeacherEmail) throw new Error('TeacherEmail required');
}

/**
 * Case-insensitive variant of findRowByKey_ — needed because emails get
 * stored in the canonical lower-case form but the user might pass them
 * mixed-case in URL hashes or arguments.
 */
function findRowByKeyCi_(tab, headers, key, value) {
  const keyCol = headers.indexOf(key);
  if (keyCol < 0) throw new Error('Header missing: ' + key);
  const range = tab.getDataRange().getValues();
  const target = String(value).toLowerCase();
  for (let i = 1; i < range.length; i++) {
    if (String(range[i][keyCol]).toLowerCase() === target) return i + 1;
  }
  return -1;
}

/**
 * For the given studentEmail, find every per-student Sheet that exists
 * across all project folders (active + archived). Returns [{projectId,
 * sheetId}] for the response.
 */
function findStudentSheetsForEmail_(emailLower) {
  const root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);
  const projects = listProjects_();
  const projectFolderById = {};
  projects.forEach((p) => { projectFolderById[p.rootFolderId] = p.projectId; });

  const out = [];
  Object.keys(projectFolderById).forEach((folderId) => {
    let pf;
    try { pf = DriveApp.getFolderById(folderId); }
    catch (e) { return; }  // folder may have been deleted manually; skip
    const classFolders = pf.getFolders();
    while (classFolders.hasNext()) {
      const cf = classFolders.next();
      const files = cf.getFilesByName(emailLower);
      while (files.hasNext()) {
        out.push({ projectId: projectFolderById[folderId], sheetId: files.next().getId() });
      }
    }
  });
  return out;
}
```

- [ ] **Step 2: Push and probe**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

In the GAS editor, paste a probe in `99_dev.js`:

```javascript
function _devProbeRosterCrud() {
  const e = 'probe.delete.me@orono.k12.mn.us';
  const added = adminAddRosterRow({First: 'Probe', Last: 'User', Email: e, Class: 'PROBE', TeacherEmail: 'paul.ivers@orono.k12.mn.us'});
  console.log('added:', JSON.stringify(added.row));
  const updated = adminUpdateRosterRow(e, {First: 'ProbeUpdated'});
  console.log('updated:', JSON.stringify(updated.row));
  const ided = adminSetStudentId(e, 'PROBE-001');
  console.log('id set:', JSON.stringify(ided.row));
  const deleted = adminDeleteRosterRow(e);
  console.log('deleted:', JSON.stringify(deleted));
}
```

Run `_devProbeRosterCrud`. Expected: each line prints sensible values; the final `deleted` shows `preservedSheets: []` (probe has no per-student Sheets). Open the Roster tab in the workbook and confirm no `probe.delete.me` row remains. Delete the probe function.

- [ ] **Step 3: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/63_admin_api.js
git commit -m "feat(admin): add roster CRUD endpoints (no email change yet)`n`nadminAddRosterRow, adminUpdateRosterRow, adminSetStudentId, adminChangeStudentId, adminDeleteRosterRow. Shared helpers canonicalizeRosterRow_, validateRosterRowOrThrow_, findRowByKeyCi_, findStudentSheetsForEmail_. Per-student Sheets preserved on row delete."
```

---

## Task 8: Admin roster — change student email (atomic rename)

**Model:** Sonnet — this is the most complex endpoint in the sub-project. Multi-Sheet rewrite + Drive rename + prefs rekey.

**Files:**
- Modify: `apps-script/src/63_admin_api.js` (append `adminChangeStudentEmail` + helpers)

The atomic guarantees the spec promises:
- Roster row's Email column updated.
- Every per-student Sheet file named `<oldEmail>` (across all projects, active or archived) is renamed to `<newEmail>`.
- Inside each such Sheet: every `createdByEmail` cell in `Sources` + `Highlights` is rewritten; `studentEmail` cell in `Meta` is rewritten.
- ScriptProperties entries keyed `prefs:<oldEmail>:*` are rekeyed to `prefs:<newEmail>:*`.

These are sequenced cheap → expensive. If a later step fails, the response includes per-step errors but the earlier steps stand.

- [ ] **Step 1: Append `adminChangeStudentEmail` to `63_admin_api.js`**

```javascript
// ============================================================
// Email change (atomic across Roster + Sheets + Drive + Prefs)
// ============================================================

/**
 * Change a student's email. Updates the Roster row, renames every
 * per-student Sheet file (active and archived projects), rewrites every
 * createdByEmail cell in Sources + Highlights of each, updates Meta's
 * studentEmail, and rekeys ScriptProperties entries from
 * `prefs:<oldEmail>:*` to `prefs:<newEmail>:*`.
 *
 * Returns { ok, oldEmail, newEmail, renamedSheets, rewrittenCells, rekeyedPrefs, errors }.
 *
 * Errors are collected per-step rather than thrown — once the Roster row
 * is updated (cheap, atomic), the rename is "official" and downstream
 * cells / files just need to catch up.
 */
function adminChangeStudentEmail(oldEmail, newEmail) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!oldEmail) throw new Error('oldEmail required');
  if (!newEmail) throw new Error('newEmail required');
  const oldL = String(oldEmail).toLowerCase().trim();
  const newL = String(newEmail).toLowerCase().trim();
  if (oldL === newL) throw new Error('Old and new emails are the same');
  if (newL.indexOf('@') < 1 || newL.indexOf('.') < 0) {
    throw new Error('newEmail does not look like an email');
  }

  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.ROSTER);
  const rosterRows = readAllAsObjects_(tab, HEADERS.ROSTER);
  if (!rosterRows.find((r) => String(r.Email || '').toLowerCase() === oldL)) {
    throw new Error('Roster row not found: ' + oldL);
  }
  if (rosterRows.find((r) => String(r.Email || '').toLowerCase() === newL)) {
    throw new Error('newEmail already in roster: ' + newL);
  }

  // ----- Step 1: Roster row email cell -----
  const rowIdx = findRowByKeyCi_(tab, HEADERS.ROSTER, 'Email', oldL);
  const emailCol = HEADERS.ROSTER.indexOf('Email') + 1;
  tab.getRange(rowIdx, emailCol).setValue(newL);

  const errors = [];
  let renamedSheets = 0;
  let rewrittenCells = 0;
  let rekeyedPrefs = 0;

  // ----- Step 2: Rename per-student Sheets + rewrite cells -----
  const sheets = findStudentSheetsForEmail_(oldL);
  sheets.forEach((s) => {
    try {
      const file = DriveApp.getFileById(s.sheetId);
      file.setName(newL);
      renamedSheets++;
      const inner = SpreadsheetApp.openById(s.sheetId);
      rewrittenCells += rewriteEmailInTab_(inner, TABS.META,       ['studentEmail'],       oldL, newL);
      rewrittenCells += rewriteEmailInTab_(inner, TABS.SOURCES,    ['createdByEmail'],     oldL, newL);
      rewrittenCells += rewriteEmailInTab_(inner, TABS.HIGHLIGHTS, ['createdByEmail'],     oldL, newL);
    } catch (e) {
      errors.push({ step: 'sheet:' + s.projectId, error: String(e && e.message || e) });
    }
  });

  // ----- Step 3: Rekey ScriptProperties prefs -----
  try {
    const props = PropertiesService.getScriptProperties();
    const all = props.getProperties();
    const oldPrefix = 'prefs:' + oldL + ':';
    const newPrefix = 'prefs:' + newL + ':';
    Object.keys(all).forEach((key) => {
      if (key.indexOf(oldPrefix) === 0) {
        const suffix = key.substring(oldPrefix.length);
        props.setProperty(newPrefix + suffix, all[key]);
        props.deleteProperty(key);
        rekeyedPrefs++;
      }
    });
  } catch (e) {
    errors.push({ step: 'prefs', error: String(e && e.message || e) });
  }

  return {
    ok: true,
    oldEmail: oldL,
    newEmail: newL,
    renamedSheets,
    rewrittenCells,
    rekeyedPrefs,
    errors,
  };
}

/**
 * Walk a tab, find cells in `cols` matching `oldEmail` (case-insensitive),
 * rewrite them to `newEmail`. Returns the count rewritten.
 */
function rewriteEmailInTab_(ss, tabName, cols, oldEmail, newEmail) {
  const tab = ss.getSheetByName(tabName);
  if (!tab) return 0;
  const data = tab.getDataRange().getValues();
  if (data.length < 2) return 0;
  const header = data[0].map((h) => String(h));
  const colIdx = cols
    .map((c) => header.indexOf(c))
    .filter((i) => i >= 0);
  if (colIdx.length === 0) return 0;
  let changed = 0;
  for (let r = 1; r < data.length; r++) {
    colIdx.forEach((c) => {
      if (String(data[r][c]).toLowerCase() === oldEmail) {
        tab.getRange(r + 1, c + 1).setValue(newEmail);
        changed++;
      }
    });
  }
  return changed;
}
```

- [ ] **Step 2: Push and probe**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

In the GAS editor, paste a probe:

```javascript
function _devProbeChangeEmail() {
  // Set up: add a probe student, provision their Sheet by triggering a
  // direct write through the same code path doPost uses.
  const dev = devSeedDevProject();
  const oldE = 'change-me@orono.k12.mn.us';
  // Insert directly into roster.
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  appendRow_(getTab_(ss, TABS.ROSTER), HEADERS.ROSTER, {
    ID: '', First: 'Change', Last: 'Me', Email: oldE,
    Class: 'DEV', Teacher: 'Paul', TeacherEmail: 'paul.ivers@orono.k12.mn.us',
  });
  // Provision the Sheet by manually calling findOrCreateStudentSheet_.
  findOrCreateStudentSheet_(oldE, dev.project);
  // Now rename.
  const result = adminChangeStudentEmail(oldE, 'changed@orono.k12.mn.us');
  console.log('result:', JSON.stringify(result, null, 2));
  // Cleanup: delete the renamed row and Sheet by hand from the workbook
  // + Drive.
}
```

Run `_devProbeChangeEmail`. Expected: `result.ok=true, renamedSheets=1, rewrittenCells>=1, rekeyedPrefs=0` (no pref entry was set). Open Drive — the dev-project class folder should show a file named `changed@orono.k12.mn.us` instead of `change-me@...`. Open that Sheet — the `Meta` tab's `studentEmail` is the new email. Cleanup: delete the Roster row + Drive file by hand. Delete the probe function.

- [ ] **Step 3: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/63_admin_api.js
git commit -m "feat(admin): adminChangeStudentEmail with atomic rename`n`nUpdates Roster row + renames every per-student Sheet (active and archived projects) + rewrites createdByEmail cells in Sources + Highlights + Meta + rekeys ScriptProperties entries from prefs:<old>:* to prefs:<new>:*. Per-step errors collected; the Roster row update is the atomic 'commit point'."
```

---

## Task 9: Admin roster — bulk replace (preview + commit)

**Model:** Sonnet — diff logic + safe atomic swap.

**Files:**
- Modify: `apps-script/src/63_admin_api.js` (append `adminPreviewReplaceRoster` + `adminReplaceRoster`)

- [ ] **Step 1: Append bulk-replace endpoints to `63_admin_api.js`**

```javascript
// ============================================================
// Bulk roster replace
// ============================================================

/**
 * Pure diff/validation pass. Never mutates. Used by the import dialog
 * to show the admin what will change before they commit.
 *
 * `rows` is an array of roster row objects (any shape; canonicalized here).
 *
 * Returns:
 *   {
 *     ok: true,
 *     added: N,            // emails in `rows` not in current
 *     removed: N,          // emails in current not in `rows`
 *     changed: N,          // emails in both but with at least one different field
 *     unchanged: N,
 *     errors: [{rowIndex, error}],
 *   }
 *
 * If errors.length > 0, the client must NOT call adminReplaceRoster.
 */
function adminPreviewReplaceRoster(rows) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  const result = analyzeRosterReplace_(rows);
  return Object.assign({ ok: true }, result);
}

/**
 * Atomic swap: validates, computes diff, clears existing roster rows,
 * appends the new ones. Per-student Sheets are NEVER touched.
 *
 * If validation errors exist, throws — caller must have run preview first.
 */
function adminReplaceRoster(rows) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  const analysis = analyzeRosterReplace_(rows);
  if (analysis.errors.length > 0) {
    throw new Error('Validation errors — run adminPreviewReplaceRoster first');
  }

  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.ROSTER);

  // Wipe existing rows (preserve header).
  const lastRow = tab.getLastRow();
  if (lastRow > 1) {
    tab.getRange(2, 1, lastRow - 1, HEADERS.ROSTER.length).clearContent();
    // Delete extra rows so subsequent reads don't see leftover blank rows.
    if (lastRow > 2) tab.deleteRows(2, lastRow - 2);
  }

  // Append the new ones in one batched write (faster than per-row appendRow_).
  const matrix = analysis.canonical.map((r) => HEADERS.ROSTER.map((h) => r[h] || ''));
  if (matrix.length > 0) {
    tab.getRange(2, 1, matrix.length, HEADERS.ROSTER.length).setValues(matrix);
  }
  return {
    ok: true,
    added: analysis.added,
    removed: analysis.removed,
    changed: analysis.changed,
    unchanged: analysis.unchanged,
  };
}

/**
 * Shared logic for preview + commit. Canonicalizes, validates, diffs
 * against the current roster. Pure.
 */
function analyzeRosterReplace_(rows) {
  const errors = [];
  const canonical = [];
  const seenEmail = {};
  const seenId = {};

  rows.forEach((r, i) => {
    const idx = i + 1;
    let c;
    try { c = canonicalizeRosterRow_(r, /*requireEmail=*/false); }
    catch (e) { errors.push({ rowIndex: idx, error: String(e.message || e) }); return; }

    if (!c.Email) errors.push({ rowIndex: idx, error: 'blank Email' });
    if (!c.First) errors.push({ rowIndex: idx, error: 'blank First' });
    if (!c.Last)  errors.push({ rowIndex: idx, error: 'blank Last' });
    if (!c.Class) errors.push({ rowIndex: idx, error: 'blank Class' });
    if (!c.TeacherEmail) errors.push({ rowIndex: idx, error: 'blank TeacherEmail' });

    if (c.Email) {
      if (seenEmail[c.Email]) errors.push({ rowIndex: idx, error: 'duplicate Email ' + c.Email });
      seenEmail[c.Email] = true;
    }
    if (c.ID) {
      if (seenId[c.ID]) errors.push({ rowIndex: idx, error: 'duplicate ID ' + c.ID });
      seenId[c.ID] = true;
    }
    canonical.push(c);
  });

  // Diff vs. current Roster.
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const current = readAllAsObjects_(getTab_(ss, TABS.ROSTER), HEADERS.ROSTER)
    .map((r) => canonicalizeRosterRow_(r, /*requireEmail=*/false));

  const currentByEmail = {};
  current.forEach((r) => { if (r.Email) currentByEmail[r.Email] = r; });
  const newByEmail = {};
  canonical.forEach((r) => { if (r.Email) newByEmail[r.Email] = r; });

  let added = 0, removed = 0, changed = 0, unchanged = 0;
  Object.keys(newByEmail).forEach((e) => {
    if (!currentByEmail[e]) { added++; return; }
    const before = currentByEmail[e];
    const after = newByEmail[e];
    const fieldsDiffer = HEADERS.ROSTER.some((h) => String(before[h] || '') !== String(after[h] || ''));
    if (fieldsDiffer) changed++; else unchanged++;
  });
  Object.keys(currentByEmail).forEach((e) => {
    if (!newByEmail[e]) removed++;
  });

  return { added, removed, changed, unchanged, errors, canonical };
}
```

- [ ] **Step 2: Push and probe**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

In the GAS editor, paste a probe:

```javascript
function _devProbeRosterReplace() {
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  // Snapshot the current roster so we can restore.
  const before = readAllAsObjects_(getTab_(ss, TABS.ROSTER), HEADERS.ROSTER);
  const sampleRows = [
    {ID:'P001', First:'Alpha', Last:'One',   Email:'a1@orono.k12.mn.us', Class:'PROBE', Teacher:'Paul', TeacherEmail:'paul.ivers@orono.k12.mn.us'},
    {ID:'P002', First:'Beta',  Last:'Two',   Email:'b2@orono.k12.mn.us', Class:'PROBE', Teacher:'Paul', TeacherEmail:'paul.ivers@orono.k12.mn.us'},
  ];
  const preview = adminPreviewReplaceRoster(sampleRows);
  console.log('preview:', JSON.stringify(preview));
  const replaced = adminReplaceRoster(sampleRows);
  console.log('replaced:', JSON.stringify(replaced));
  // Restore.
  adminReplaceRoster(before);
  console.log('restored to', before.length, 'rows');
}
```

Run `_devProbeRosterReplace`. Expected: `preview.added=2, removed=~N, errors=[]`. After `replaced` runs, the Roster tab has exactly 2 rows. After restore, the Roster tab has the original rows back. Delete the probe.

- [ ] **Step 3: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/63_admin_api.js
git commit -m "feat(admin): bulk roster replace (preview + atomic swap)`n`nadminPreviewReplaceRoster validates + diffs without mutating. adminReplaceRoster wipes the Roster tab's data rows and rewrites in one batched setValues. Per-student Sheets untouched."
```

---

## Task 10: Admin staff endpoints + last-admin guard

**Model:** Sonnet — the last-admin guard is the failure case to keep honest.

**Files:**
- Modify: `apps-script/src/63_admin_api.js` (append staff endpoints + `ensureNotLastAdminRemoval_`)

- [ ] **Step 1: Append staff endpoints to `63_admin_api.js`**

```javascript
// ============================================================
// Staff CRUD + last-admin guard
// ============================================================

/**
 * Throws 'Cannot remove the only admin — promote another staff member
 * first' if changing `targetEmail` to `newRole` would leave the Staff
 * sheet with zero admins.
 *
 * Called by adminUpdateStaffRow (when Role changes), adminChangeStaffEmail
 * (the email change itself doesn't change Role, but the row identity is
 * being touched — passes the current Role through), and adminDeleteStaffRow
 * (newRole='__delete__' sentinel — any non-admin value works).
 */
function ensureNotLastAdminRemoval_(targetEmail, newRole) {
  if (newRole === ROLES.ADMIN) return;
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const all = readAllAsObjects_(getTab_(ss, TABS.STAFF), HEADERS.STAFF);
  const admins = all.filter((r) => r.Role === ROLES.ADMIN);
  const targetLower = String(targetEmail).toLowerCase();
  if (admins.length === 1 && String(admins[0].Email).toLowerCase() === targetLower) {
    throw new Error('Cannot remove the only admin — promote another staff member first');
  }
}

function adminGetStaff() {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const rows = readAllAsObjects_(getTab_(ss, TABS.STAFF), HEADERS.STAFF);
  return {
    ok: true,
    rows: rows.map((r) => ({
      Name:  String(r.Name || ''),
      Email: String(r.Email || '').toLowerCase(),
      Role:  String(r.Role || ''),
    })),
  };
}

function adminAddStaffRow(row) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!row) throw new Error('row required');
  const name = String(row.Name || '').trim();
  const email = String(row.Email || '').trim().toLowerCase();
  const role = String(row.Role || '').trim().toLowerCase();
  if (!name)  throw new Error('Name required');
  if (!email) throw new Error('Email required');
  if (role !== ROLES.TEACHER && role !== ROLES.ADMIN) throw new Error('Role must be teacher or admin');
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.STAFF);
  const all = readAllAsObjects_(tab, HEADERS.STAFF);
  if (all.some((r) => String(r.Email || '').toLowerCase() === email)) {
    throw new Error('Email already in staff: ' + email);
  }
  const stored = { Name: name, Email: email, Role: role };
  appendRow_(tab, HEADERS.STAFF, stored);
  return { ok: true, row: stored };
}

function adminUpdateStaffRow(email, fields) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!email) throw new Error('email required');
  if (!fields) throw new Error('fields required');
  const target = String(email).toLowerCase();
  const updates = {};
  if ('Name' in fields) updates.Name = String(fields.Name || '');
  if ('Role' in fields) {
    const nr = String(fields.Role || '').toLowerCase();
    if (nr !== ROLES.TEACHER && nr !== ROLES.ADMIN) throw new Error('Role must be teacher or admin');
    updates.Role = nr;
    ensureNotLastAdminRemoval_(target, nr);
  }
  if (Object.keys(updates).length === 0) throw new Error('No editable fields supplied');

  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.STAFF);
  const rowIdx = findRowByKeyCi_(tab, HEADERS.STAFF, 'Email', target);
  if (rowIdx < 0) throw new Error('Staff row not found: ' + target);
  HEADERS.STAFF.forEach((header, i) => {
    if (header in updates) tab.getRange(rowIdx, i + 1).setValue(updates[header]);
  });
  const all = readAllAsObjects_(tab, HEADERS.STAFF);
  const updated = all.find((r) => String(r.Email || '').toLowerCase() === target);
  return { ok: true, row: updated };
}

function adminChangeStaffEmail(oldEmail, newEmail) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!oldEmail) throw new Error('oldEmail required');
  if (!newEmail) throw new Error('newEmail required');
  const oldL = String(oldEmail).toLowerCase().trim();
  const newL = String(newEmail).toLowerCase().trim();
  if (oldL === newL) throw new Error('Old and new emails are the same');

  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.STAFF);
  const all = readAllAsObjects_(tab, HEADERS.STAFF);
  const target = all.find((r) => String(r.Email || '').toLowerCase() === oldL);
  if (!target) throw new Error('Staff row not found: ' + oldL);
  if (all.some((r) => String(r.Email || '').toLowerCase() === newL)) {
    throw new Error('newEmail already in staff: ' + newL);
  }
  // If the target is the only admin, ensure the new email row preserves the role.
  // (We're changing email, not role — the guard is informational here.)
  // Update the cell.
  const rowIdx = findRowByKeyCi_(tab, HEADERS.STAFF, 'Email', oldL);
  const emailCol = HEADERS.STAFF.indexOf('Email') + 1;
  tab.getRange(rowIdx, emailCol).setValue(newL);
  return { ok: true, oldEmail: oldL, newEmail: newL };
}

function adminDeleteStaffRow(email) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!email) throw new Error('email required');
  const target = String(email).toLowerCase();
  // Treat deletion as "set role to <nothing>" for the guard.
  ensureNotLastAdminRemoval_(target, '__deleted__');
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.STAFF);
  const rowIdx = findRowByKeyCi_(tab, HEADERS.STAFF, 'Email', target);
  if (rowIdx < 0) throw new Error('Staff row not found: ' + target);
  tab.deleteRow(rowIdx);
  return { ok: true, email: target };
}
```

- [ ] **Step 2: Push and probe the last-admin guard**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

In the GAS editor, paste a probe:

```javascript
function _devProbeStaffGuard() {
  // Add a temporary second admin so the test doesn't lock us out.
  adminAddStaffRow({Name: 'Probe Admin', Email: 'probe.admin@orono.k12.mn.us', Role: 'admin'});
  // Now demote Paul.
  try {
    adminUpdateStaffRow('paul.ivers@orono.k12.mn.us', {Role: 'teacher'});
    console.log('demote allowed (2 admins exist)');
  } catch (e) { console.log('FAIL: should allow demote when 2 admins exist:', e.message); }
  // Cleanup: promote Paul back, delete the probe admin.
  adminUpdateStaffRow('paul.ivers@orono.k12.mn.us', {Role: 'admin'});
  adminDeleteStaffRow('probe.admin@orono.k12.mn.us');
  // Now try to demote when Paul is the only admin.
  try {
    adminUpdateStaffRow('paul.ivers@orono.k12.mn.us', {Role: 'teacher'});
    console.log('FAIL: demote of only admin was allowed');
  } catch (e) { console.log('blocked as expected:', e.message); }
}
```

Run `_devProbeStaffGuard`. Expected log: `demote allowed (2 admins exist)`, then `blocked as expected: Cannot remove the only admin — promote another staff member first`. Delete the probe.

- [ ] **Step 3: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/63_admin_api.js
git commit -m "feat(admin): staff CRUD with last-admin guard`n`nadminGetStaff/Add/Update/ChangeEmail/Delete + ensureNotLastAdminRemoval_. Role change or delete that would zero out admins is rejected server-side."
```

---

## Task 11: Archive school year endpoints + dashboard banner data

**Model:** Sonnet — bulk operation + small dashboard change in one cohesive commit.

**Files:**
- Modify: `apps-script/src/63_admin_api.js` (append archive-year endpoints)
- Modify: `apps-script/src/61_console_api.js` (`consoleGetProjectDashboard` returns `recentUnarchive`)

- [ ] **Step 1: Append archive-year endpoints to `63_admin_api.js`**

```javascript
// ============================================================
// Archive school year
// ============================================================

/**
 * Distinct schoolYear strings from currently-active projects, sorted
 * descending (so newest year floats to the top of the dropdown).
 */
function adminListArchivableYears() {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  const set = {};
  listProjects_().forEach((p) => {
    if (p.status === PROJECT_STATUS.ACTIVE && p.schoolYear) set[p.schoolYear] = true;
  });
  return { ok: true, years: Object.keys(set).sort().reverse() };
}

/**
 * The active projects in the given year + a summary row count, so the
 * UI can show "this will affect N projects" before commit.
 */
function adminPreviewArchiveYear(schoolYear) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!schoolYear) throw new Error('schoolYear required');

  const projects = listProjects_().filter(
    (p) => p.schoolYear === schoolYear && p.status === PROJECT_STATUS.ACTIVE
  );

  // Roster-side student counts (no per-Sheet opens).
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const rosterRows = readAllAsObjects_(getTab_(ss, TABS.ROSTER), HEADERS.ROSTER);

  const out = projects.map((p) => {
    const classes = projectClassList_(p);
    const count = rosterRows.filter(
      (r) => r.Class && classes.indexOf(String(r.Class).trim()) >= 0
    ).length;
    return {
      projectId: p.projectId,
      name: p.name,
      memberClasses: classes,
      studentCount: count,
    };
  });
  return { ok: true, schoolYear, projects: out };
}

/**
 * Bulk archive every active project in the given year. Confirm phrase
 * must equal `ARCHIVE <schoolYear>` exactly (server re-checks client
 * gating).
 *
 * Calls the shared archiveSchoolYear_ helper in 65_lifecycle.js.
 */
function adminArchiveSchoolYear(schoolYear, confirmPhrase) {
  const actorEmail = getActorEmail_();
  assertAdmin_(actorEmail);
  if (!schoolYear) throw new Error('schoolYear required');
  const expected = 'ARCHIVE ' + schoolYear;
  if (String(confirmPhrase || '') !== expected) {
    throw new Error('Confirm phrase mismatch — expected "' + expected + '"');
  }
  return archiveSchoolYear_(schoolYear, actorEmail);
}
```

- [ ] **Step 2: Extend `consoleGetProjectDashboard` in `61_console_api.js` to return `recentUnarchive`**

In `apps-script/src/61_console_api.js`, locate the `return { ok: true, project: {...}, students, asOf: nowIso_(), };` at the bottom of `consoleGetProjectDashboard`. Replace that block with:

```javascript
  const unarchive = latestUnarchiveFor_(project.projectId);
  const banner = (function () {
    if (!unarchive) return undefined;
    const ageMs = Date.now() - new Date(unarchive.at).getTime();
    if (ageMs < 0 || ageMs > 7 * 24 * 3600 * 1000) return undefined;
    return { eventId: unarchive.eventId, actor: unarchive.actor, at: unarchive.at };
  })();

  const resp = {
    ok: true,
    project: {
      projectId: project.projectId,
      name: project.name,
      schoolYear: project.schoolYear,
      bundleName: bundle ? bundle.name : '',
      memberClasses: projectClasses,
      scopedClasses,
    },
    students,
    asOf: nowIso_(),
  };
  if (banner) resp.recentUnarchive = banner;
  return resp;
}
```

(Remove the original `return { ... }`; the new block ends with the same closing brace for the function.)

- [ ] **Step 3: Push and probe**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

In the GAS editor, paste a probe:

```javascript
function _devProbeArchiveYear() {
  const years = adminListArchivableYears();
  console.log('years:', JSON.stringify(years));
  if (years.years.length === 0) { console.log('no active projects; create one then retry'); return; }
  const y = years.years[0];
  const prev = adminPreviewArchiveYear(y);
  console.log('preview:', JSON.stringify(prev, null, 2));
  // Don't actually archive (would touch production); just verify the read paths.
}
```

Run `_devProbeArchiveYear`. Expected log: distinct list of school years; preview of the most recent year showing project names + student counts. Delete the probe.

Also verify the dashboard banner data: load the Project Dashboard for the seeded Dev Project in the browser. Should still load normally; with no recent unarchive event, the response will have no `recentUnarchive` field (the client banner work in Task 16 will pick this up).

- [ ] **Step 4: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/63_admin_api.js apps-script/src/61_console_api.js
git commit -m "feat(admin): bulk archive school year + dashboard recentUnarchive banner data`n`nadminListArchivableYears, adminPreviewArchiveYear, adminArchiveSchoolYear (delegates to archiveSchoolYear_). consoleGetProjectDashboard now includes recentUnarchive when an unarchive event for the project is within the last 7 days."
```

---

## Task 12: Dev tests for sub-project C

**Model:** Sonnet — test design judgment.

**Files:**
- Modify: `apps-script/src/99_dev.js` (append the 5 dev tests under a new section header)

All tests are editor-callable. They seed → assert → cleanup, matching the patterns established by Phase 4 A+B tests in `99_dev.js`.

- [ ] **Step 1: Append dev tests to `99_dev.js`**

At the bottom of `apps-script/src/99_dev.js`, append:

```javascript
// ============================================================
// Sub-project C: admin area + lifecycle
// ============================================================

/**
 * Verifies that every admin* endpoint rejects non-admin callers.
 *
 * Approach: stash the actor's true row, demote them to teacher, run
 * every endpoint, expect each to throw 'Admin only', restore the actor.
 * Editor-only because we need a real Session.getActiveUser context.
 */
function devTestAdminAuthGate() {
  const checks = [];
  const check = (label, ok) => { checks.push({ label, ok }); };

  const actor = getActorEmail_();
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.STAFF);
  const rowIdx = findRowByKeyCi_(tab, HEADERS.STAFF, 'Email', actor);
  if (rowIdx < 0) {
    console.log('devTestAdminAuthGate skipped — actor not in Staff sheet');
    return { ok: false, reason: 'actor not in Staff' };
  }
  // Add a second admin so we don't trigger the last-admin guard mid-test.
  adminAddStaffRow({Name: 'Backup Admin', Email: 'backup.admin@orono.k12.mn.us', Role: 'admin'});

  // Demote.
  const roleCol = HEADERS.STAFF.indexOf('Role') + 1;
  tab.getRange(rowIdx, roleCol).setValue(ROLES.TEACHER);

  const endpoints = [
    () => adminGetRoster(),
    () => adminAddRosterRow({First:'X', Last:'Y', Email:'x@orono.k12.mn.us', Class:'X', TeacherEmail:actor}),
    () => adminUpdateRosterRow('any@orono.k12.mn.us', {First:'X'}),
    () => adminChangeStudentEmail('a@orono.k12.mn.us', 'b@orono.k12.mn.us'),
    () => adminDeleteRosterRow('any@orono.k12.mn.us'),
    () => adminGetStaff(),
    () => adminListArchivableYears(),
    () => adminPreviewArchiveYear('any'),
  ];
  endpoints.forEach((fn, i) => {
    try { fn(); check('endpoint ' + i + ' should have thrown', false); }
    catch (e) { check('endpoint ' + i + ' rejected: ' + e.message, String(e.message).indexOf('Admin only') >= 0); }
  });

  // Restore.
  tab.getRange(rowIdx, roleCol).setValue(ROLES.ADMIN);
  adminDeleteStaffRow('backup.admin@orono.k12.mn.us');

  const pass = checks.every((c) => c.ok);
  console.log(JSON.stringify({ ok: pass, checks }, null, 2));
  return { ok: pass };
}

/**
 * Roster CRUD: add, update, set ID, change ID, delete. Cleans up after itself.
 */
function devTestAdminRosterCrud() {
  const checks = [];
  const check = (label, ok) => { checks.push({ label, ok }); };
  const e = 'crud.probe@orono.k12.mn.us';

  const added = adminAddRosterRow({First:'Crud', Last:'Probe', Email:e, Class:'PROBE', TeacherEmail: getActorEmail_()});
  check('added.ok', added.ok === true);
  check('added.row.Email', added.row.Email === e);

  const updated = adminUpdateRosterRow(e, {First: 'CrudUpdated'});
  check('updated.ok', updated.ok === true);
  check('updated.First', updated.row.First === 'CrudUpdated');

  const ided = adminSetStudentId(e, 'CRUD-001');
  check('set id ok', ided.ok === true);
  check('id stored', ided.row.ID === 'CRUD-001');

  try { adminSetStudentId(e, 'CRUD-002'); check('refused second set', false); }
  catch (err) { check('refused second set', String(err.message).indexOf('already set') >= 0); }

  const changed = adminChangeStudentId(e, 'CRUD-999');
  check('change id ok', changed.ok === true);
  check('changed id', changed.row.ID === 'CRUD-999');

  const deleted = adminDeleteRosterRow(e);
  check('deleted.ok', deleted.ok === true);

  // Verify the row is gone.
  const r = adminGetRoster();
  check('row removed', !r.rows.find((x) => x.Email === e));

  const pass = checks.every((c) => c.ok);
  console.log(JSON.stringify({ ok: pass, checks }, null, 2));
  return { ok: pass };
}

/**
 * Bulk replace: snapshot current → replace with a small set → assert
 * shape → restore. Never leaves the roster in a broken state even on
 * test failure (cleanup runs regardless via try/finally).
 */
function devTestAdminRosterReplace() {
  const checks = [];
  const check = (label, ok) => { checks.push({ label, ok }); };

  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.STAFF);
  const before = readAllAsObjects_(getTab_(ss, TABS.ROSTER), HEADERS.ROSTER);
  const tester = getActorEmail_();
  try {
    const sample = [
      {ID:'R1', First:'Replace', Last:'One',   Email:'r1@orono.k12.mn.us', Class:'PROBE', Teacher:'Paul', TeacherEmail: tester},
      {ID:'R2', First:'Replace', Last:'Two',   Email:'r2@orono.k12.mn.us', Class:'PROBE', Teacher:'Paul', TeacherEmail: tester},
      {ID:'R3', First:'Replace', Last:'Three', Email:'r3@orono.k12.mn.us', Class:'PROBE', Teacher:'Paul', TeacherEmail: tester},
    ];
    const preview = adminPreviewReplaceRoster(sample);
    check('preview ok', preview.ok === true);
    check('preview no errors', preview.errors.length === 0);
    check('preview added 3', preview.added === 3);
    const replaced = adminReplaceRoster(sample);
    check('replaced ok', replaced.ok === true);
    const after = adminGetRoster();
    check('roster has 3 rows', after.rows.length === 3);
    check('roster includes r2', !!after.rows.find((r) => r.Email === 'r2@orono.k12.mn.us'));
  } finally {
    // Restore — always runs.
    adminReplaceRoster(before.map((r) => ({
      ID: r.ID, First: r.First, Last: r.Last, Email: r.Email,
      Class: r.Class, Teacher: r.Teacher, TeacherEmail: r.TeacherEmail,
    })));
  }

  const pass = checks.every((c) => c.ok);
  console.log(JSON.stringify({ ok: pass, checks }, null, 2));
  return { ok: pass };
}

/**
 * Atomic email change: stand up a student + per-student Sheet + scratch
 * pref → rename → assert all five places updated → cleanup.
 */
function devTestAdminEmailChange() {
  const checks = [];
  const check = (label, ok) => { checks.push({ label, ok }); };
  const dev = devSeedDevProject();
  const oldE = 'rename.old@orono.k12.mn.us';
  const newE = 'rename.new@orono.k12.mn.us';

  adminAddRosterRow({First:'Rename', Last:'Probe', Email:oldE, Class:'DEV', Teacher:'Paul', TeacherEmail: getActorEmail_()});
  // Provision Sheet + populate one source + one highlight with createdByEmail=oldE.
  const sheet = findOrCreateStudentSheet_(oldE, dev.project);
  upsertSource_(sheet, {
    sourceId: 'rename-src',
    projectId: dev.project.projectId,
    normalizedUrl: 'https://example.com/rename',
    rawUrl: 'https://example.com/rename',
    accessDate: nowIso_(),
    scrapedTitle: 'Rename probe',
    sourceType: 'website',
    createdByEmail: oldE,
    createdAt: nowIso_(),
  });
  upsertHighlight_(sheet, {
    highlightId: 'rename-hl',
    sourceId: 'rename-src',
    projectId: dev.project.projectId,
    primaryCategory: 'Background',
    highlightedText: 'rename test',
    createdByEmail: oldE,
    createdAt: nowIso_(),
  });
  setUserPref_(oldE, 'activeProjectId', dev.project.projectId);

  const result = adminChangeStudentEmail(oldE, newE);
  check('result.ok', result.ok === true);
  check('renamedSheets >= 1', result.renamedSheets >= 1);
  check('rewrittenCells >= 3', result.rewrittenCells >= 3);   // Meta + Sources + Highlights
  check('rekeyedPrefs === 1', result.rekeyedPrefs === 1);

  // Confirm Sheet file rename.
  const found = findStudentSheetsForEmail_(newE);
  check('new email has Sheet', found.length === 1);

  // Confirm pref carried over.
  check('pref carried over', getUserPref_(newE, 'activeProjectId') === dev.project.projectId);
  check('old pref gone',     getUserPref_(oldE, 'activeProjectId') === null);

  // Cleanup.
  adminDeleteRosterRow(newE);
  setUserPref_(newE, 'activeProjectId', '');
  // Sheet file is preserved (intended); ok for dev junk.

  const pass = checks.every((c) => c.ok);
  console.log(JSON.stringify({ ok: pass, checks }, null, 2));
  return { ok: pass };
}

/**
 * Bulk archive school year: seed 3 projects in 'dev-yy' + 1 in 'other-yy';
 * archive 'dev-yy'; verify; unarchive one; verify; cleanup.
 *
 * NOTE: this test creates Drive folders. They are cleaned at the end but
 * Apps Script Drive ops are not transactional — if the test crashes mid-
 * run, the dev folder layout will need a manual cleanup pass.
 */
function devTestArchiveSchoolYear() {
  const checks = [];
  const check = (label, ok) => { checks.push({ label, ok }); };
  const actor = getActorEmail_();
  const bundleId = listBundles_()[0].bundleId;
  const ids = [];
  try {
    ['dev-yy:Alpha', 'dev-yy:Beta', 'dev-yy:Gamma', 'other-yy:Delta'].forEach((label) => {
      const [year, name] = label.split(':');
      const p = createProject_({
        name: 'archive-test ' + name,
        schoolYear: year,
        bundleId,
        memberClasses: ['DEV'],
        createdBy: actor,
      });
      ids.push(p.projectId);
    });

    const result = adminArchiveSchoolYear('dev-yy', 'ARCHIVE dev-yy');
    check('result ok',       result.ok === true);
    check('archived 3',      result.archived.length === 3);
    check('errors empty',    result.errors.length === 0);

    // Confirm registry states.
    const allAfter = listProjects_();
    const dyyArchived = allAfter.filter((p) => p.schoolYear === 'dev-yy' && p.status === PROJECT_STATUS.ARCHIVED);
    check('dev-yy all archived', dyyArchived.length === 3);
    const otherActive = allAfter.find((p) => p.schoolYear === 'other-yy' && p.name === 'archive-test Delta');
    check('other-yy untouched',   otherActive && otherActive.status === PROJECT_STATUS.ACTIVE);

    // Confirm Drive moves on first archived project.
    const firstArchived = allAfter.find((p) => p.projectId === ids[0]);
    const folder = DriveApp.getFolderById(firstArchived.rootFolderId);
    const parents = folder.getParents();
    let underArchived = false;
    while (parents.hasNext()) {
      if (parents.next().getName() === NAMES.ARCHIVED_FOLDER) underArchived = true;
    }
    check('first project under Archived/', underArchived);

    // Confirm 3 audit events written.
    const events = ids.slice(0, 3).map((id) => listAuditEventsForProject_(id));
    check('audit events for each', events.every((arr) => arr.length >= 1));

    // Unarchive one — separate path. Verify audit + folder restore.
    const unResult = consoleUnarchiveProject(ids[0]);
    check('unarchive ok', unResult.ok === true);
    const restoredFolder = DriveApp.getFolderById(firstArchived.rootFolderId);
    const restoredParents = restoredFolder.getParents();
    let underRoot = false;
    while (restoredParents.hasNext()) {
      if (restoredParents.next().getId() === CONFIG.ROOT_FOLDER_ID) underRoot = true;
    }
    check('first project restored to root', underRoot);

    const unEvents = listAuditEventsForProject_(ids[0]).filter((e) => e.action === AUDIT_ACTIONS.UNARCHIVE);
    check('unarchive audit event written', unEvents.length === 1);
  } finally {
    // Cleanup: archive the unarchived one back, then "delete" all 4 projects
    // by archiving them — actual deletion is out of scope. The dev folders
    // accumulate; clean by hand in the GAS UI / Drive if they pile up.
    ids.forEach((id) => {
      try { archiveProject_(id); } catch (e) { /* may already be archived */ }
    });
  }
  const pass = checks.every((c) => c.ok);
  console.log(JSON.stringify({ ok: pass, checks }, null, 2));
  return { ok: pass };
}
```

- [ ] **Step 2: Push and run the five tests in order**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

From the GAS editor, run in this order — each should print `ok: true`:

1. `devTestAdminAuthGate`
2. `devTestAdminRosterCrud`
3. `devTestAdminRosterReplace`
4. `devTestAdminEmailChange`
5. `devTestArchiveSchoolYear`

(These tests are heavier than the A+B set — Drive operations, atomic renames, multi-Sheet rewrites. Expect 30-90 seconds each.)

If any fails, inspect the printed `checks` array for the failing label and debug. Common failure modes:
- `devTestAdminAuthGate`: actor missing from Staff sheet (Step 1 short-circuits with a `reason`).
- `devTestAdminEmailChange`: `findStudentSheetsForEmail_` returning 0 — confirm `findOrCreateStudentSheet_` actually provisioned (check the dev project folder in Drive).
- `devTestArchiveSchoolYear`: a dev project was created but never cleaned up from a prior run. Manually archive + move folder if needed.

- [ ] **Step 3: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/99_dev.js
git commit -m "test(admin): add 5 devTest* functions for sub-project C`n`ndevTestAdminAuthGate, devTestAdminRosterCrud, devTestAdminRosterReplace, devTestAdminEmailChange, devTestArchiveSchoolYear. All cleanup-safe via try/finally where Drive ops are involved."
```

---

## Task 13: Header Admin ▾ dropdown + hash routing + admin_js scaffold

**Model:** Sonnet — touches the SPA shell + adds a new partial. Foundational for the next four tasks.

**Files:**
- Modify: `apps-script/src/console.html` (add `admin_js` include)
- Modify: `apps-script/src/console_js.html` (header dropdown; `parseHash_` extension; `renderView_` delegation; admin view stubs)
- Create: `apps-script/src/admin_js.html` (scaffold with view-state, render stubs, shared typed-confirm modal helper)
- Modify: `apps-script/src/console_css.html` (header dropdown + typed-confirm modal styles)

This task lands the scaffolding so Tasks 14-17 can each implement one screen against a working nav.

- [ ] **Step 1: Add the `admin_js` include in `console.html`**

In `apps-script/src/console.html`, modify the body so it reads:

```html
<!DOCTYPE html>
<html>
  <head>
    <base target="_top" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OPS Research Tool</title>
    <?!= includeFile_('console_css') ?>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
  </head>
  <body>
    <div id="console-root">
      <div class="console-boot">Loading…</div>
    </div>
    <?!= includeFile_('console_js') ?>
    <?!= includeFile_('admin_js') ?>
  </body>
</html>
```

The order matters: `console_js` defines `state`, `setStatus`, `onFail_`, `esc_`, `navigate_`, `renderShell_`. `admin_js` consumes those.

- [ ] **Step 2: Extend `parseHash_` and `applyHash_` in `console_js.html`**

In `apps-script/src/console_js.html`, replace `parseHash_` (currently at line 68) with:

```javascript
function parseHash_(hash) {
  const h = String(hash || '').replace(/^#\/?/, '');
  if (!h || h === 'projects') return { view: 'MY_PROJECTS' };
  const parts = h.split('/');

  // Admin routes.
  if (parts[0] === 'admin') {
    if (parts[1] === 'roster')        return { view: 'ADMIN_ROSTER' };
    if (parts[1] === 'staff')         return { view: 'ADMIN_STAFF' };
    if (parts[1] === 'archive-year')  return { view: 'ADMIN_LIFECYCLE' };
    return { view: 'ADMIN_ROSTER' };  // default admin landing
  }

  // Existing teacher routes.
  if (parts[0] !== 'projects') return { view: 'MY_PROJECTS' };
  if (parts.length === 2)
    return { view: 'DASHBOARD', projectId: decodeURIComponent(parts[1]) };
  if (parts.length === 4 && parts[2] === 'students')
    return {
      view: 'STUDENT',
      projectId: decodeURIComponent(parts[1]),
      studentEmail: decodeURIComponent(parts[3]),
    };
  return { view: 'MY_PROJECTS' };
}
```

- [ ] **Step 3: Extend `renderView_` to delegate admin views**

In `apps-script/src/console_js.html`, locate `renderView_` (around line 131). Replace it with:

```javascript
function renderView_(main) {
  switch (state.view) {
    case 'MY_PROJECTS':    return renderMyProjects_(main);
    case 'DASHBOARD':      return renderDashboard_(main);
    case 'STUDENT':        return renderStudentDetail_(main);
    case 'ADMIN_ROSTER':   return renderAdminRoster_(main);
    case 'ADMIN_STAFF':    return renderAdminStaff_(main);
    case 'ADMIN_LIFECYCLE':return renderAdminLifecycle_(main);
    default:
      main.innerHTML = '<div class="console-empty">Unknown view.</div>';
  }
}
```

The `renderAdmin*_` functions are defined in `admin_js.html` (Step 5).

- [ ] **Step 4: Add the Admin ▾ dropdown to `buildHeader_` in `console_js.html`**

In `apps-script/src/console_js.html`, replace `buildHeader_` (around line 1433) with:

```javascript
function buildHeader_() {
  const h = document.createElement('header');
  h.className = 'console-header';

  // Title — clickable to return to My Projects.
  const title = document.createElement('div');
  title.className = 'console-header__title';
  title.textContent = 'OPS Research Tool';
  title.style.cursor = 'pointer';
  title.addEventListener('click', () => navigate_('/projects'));
  h.appendChild(title);

  const right = document.createElement('div');
  right.className = 'console-header__right';

  // Admin dropdown — visible only when role === 'admin'.
  if (state.ctx && state.ctx.role === 'admin') {
    right.appendChild(buildAdminDropdown_());
  }

  const actor = document.createElement('div');
  actor.className = 'console-header__actor';
  actor.innerHTML = '<strong></strong>';
  actor.querySelector('strong').textContent = state.ctx.staff.Name || state.ctx.actor;
  const tag = document.createElement('span');
  tag.className = 'console-header__role-tag' + (state.ctx.role === 'admin' ? ' console-header__role-tag--admin' : '');
  tag.textContent = state.ctx.role;
  actor.appendChild(tag);
  right.appendChild(actor);

  h.appendChild(right);
  return h;
}

function buildAdminDropdown_() {
  const wrap = document.createElement('div');
  wrap.className = 'console-header__admin';

  const btn = document.createElement('button');
  btn.className = 'console-header__admin-btn';
  btn.textContent = 'Admin ▾';
  wrap.appendChild(btn);

  const menu = document.createElement('div');
  menu.className = 'console-header__admin-menu';
  const opts = [
    { label: 'Roster',                path: '/admin/roster' },
    { label: 'Staff',                 path: '/admin/staff' },
    { label: 'Archive school year',   path: '/admin/archive-year' },
  ];
  opts.forEach((o) => {
    const a = document.createElement('button');
    a.className = 'console-header__admin-item';
    a.textContent = o.label;
    a.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.remove('console-header__admin-menu--open');
      navigate_(o.path);
    });
    menu.appendChild(a);
  });
  wrap.appendChild(menu);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('console-header__admin-menu--open');
  });
  // Click anywhere else closes it.
  document.addEventListener('click', () => {
    menu.classList.remove('console-header__admin-menu--open');
  });
  return wrap;
}
```

- [ ] **Step 5: Create `apps-script/src/admin_js.html` (scaffold + shared typed-confirm helper)**

```html
<script>
// ============================================================
// OPS Research Tool — Admin views
//
// Loaded alongside console_js.html. Shares the `state`, `setStatus`,
// `onFail_`, `esc_`, `navigate_` globals defined there.
//
// Adds three views: ADMIN_ROSTER, ADMIN_STAFF, ADMIN_LIFECYCLE.
// Tasks 14-17 fill in the view bodies.
// ============================================================

// ---------- Shared admin state objects ----------

const adminRoster = {
  rows: null,
  search: '',
  classFilter: 'All',
  teacherFilter: 'All',
  sort: { column: 'Last', dir: 'asc' },
  openMenuEmail: null,
};

const adminStaff = {
  rows: null,
  openMenuEmail: null,
};

const adminLifecycle = {
  years: null,
  selectedYear: null,
  preview: null,
  confirmText: '',
};

// ---------- View entry points (stubs replaced by Tasks 14-17) ----------

function renderAdminRoster_(main) {
  // Implemented in Task 14.
  main.innerHTML = '<div class="console-empty">Admin Roster — coming in Task 14.</div>';
}

function renderAdminStaff_(main) {
  // Implemented in Task 16.
  main.innerHTML = '<div class="console-empty">Admin Staff — coming in Task 16.</div>';
}

function renderAdminLifecycle_(main) {
  // Implemented in Task 17.
  main.innerHTML = '<div class="console-empty">Archive School Year — coming in Task 17.</div>';
}

// ---------- Shared typed-confirm modal helper ----------

/**
 * Open a typed-confirm modal. The danger button stays disabled until the
 * user types `args.phrase` exactly (case-sensitive). Closes on Cancel,
 * on Esc, or after onConfirm completes.
 *
 * args:
 *   title: string
 *   bodyHtml: string (innerHTML — caller is responsible for escaping)
 *   phrase: string                       (e.g., 'CHANGE EMAIL')
 *   dangerLabel: string                  (button label, e.g., 'Change email')
 *   onConfirm: function () -> Promise|void
 *
 * Returns nothing.
 */
function typedConfirmModal_(args) {
  const overlay = document.createElement('div');
  overlay.className = 'admin-modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'admin-modal admin-modal--typed';

  const header = document.createElement('div');
  header.className = 'admin-modal__header';
  header.textContent = args.title;
  modal.appendChild(header);

  const body = document.createElement('div');
  body.className = 'admin-modal__body';
  body.innerHTML = args.bodyHtml;
  modal.appendChild(body);

  const phrase = document.createElement('div');
  phrase.className = 'admin-modal__phrase';
  phrase.innerHTML = 'Type <code></code> to confirm.';
  phrase.querySelector('code').textContent = args.phrase;
  modal.appendChild(phrase);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'admin-modal__input';
  input.autocomplete = 'off';
  modal.appendChild(input);

  const actions = document.createElement('div');
  actions.className = 'admin-modal__actions';
  const cancel = document.createElement('button');
  cancel.className = 'admin-modal__cancel';
  cancel.textContent = 'Cancel';
  const confirm = document.createElement('button');
  confirm.className = 'admin-modal__danger';
  confirm.textContent = args.dangerLabel;
  confirm.disabled = true;
  actions.appendChild(cancel);
  actions.appendChild(confirm);
  modal.appendChild(actions);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const close = () => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.removeEventListener('keydown', escListener);
  };
  const escListener = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', escListener);

  input.addEventListener('input', () => {
    confirm.disabled = (input.value !== args.phrase);
  });

  cancel.addEventListener('click', close);
  confirm.addEventListener('click', () => {
    confirm.disabled = true;
    confirm.textContent = '…';
    const ret = args.onConfirm();
    if (ret && typeof ret.then === 'function') {
      ret.then(close).catch((e) => {
        confirm.disabled = false;
        confirm.textContent = args.dangerLabel;
        setStatus(String(e && e.message || e), 'bad', 4000);
      });
    } else {
      close();
    }
  });

  setTimeout(() => input.focus(), 50);
}

/**
 * Open a plain (no typed phrase) confirm modal. Cleaner than the
 * typed shell when the operation is reversible (e.g., unarchive,
 * delete row with no work).
 */
function plainConfirmModal_(args) {
  const overlay = document.createElement('div');
  overlay.className = 'admin-modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'admin-modal';

  const header = document.createElement('div');
  header.className = 'admin-modal__header';
  header.textContent = args.title;
  modal.appendChild(header);

  const body = document.createElement('div');
  body.className = 'admin-modal__body';
  body.innerHTML = args.bodyHtml;
  modal.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'admin-modal__actions';
  const cancel = document.createElement('button');
  cancel.className = 'admin-modal__cancel';
  cancel.textContent = 'Cancel';
  const confirm = document.createElement('button');
  confirm.className = args.danger ? 'admin-modal__danger' : 'admin-modal__primary';
  confirm.textContent = args.confirmLabel || 'OK';
  actions.appendChild(cancel);
  actions.appendChild(confirm);
  modal.appendChild(actions);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const close = () => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.removeEventListener('keydown', escListener);
  };
  const escListener = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', escListener);
  cancel.addEventListener('click', close);
  confirm.addEventListener('click', () => {
    confirm.disabled = true;
    confirm.textContent = '…';
    const ret = args.onConfirm();
    if (ret && typeof ret.then === 'function') {
      ret.then(close).catch((e) => {
        confirm.disabled = false;
        confirm.textContent = args.confirmLabel || 'OK';
        setStatus(String(e && e.message || e), 'bad', 4000);
      });
    } else {
      close();
    }
  });
}

// ---------- Shared helper: breadcrumb header for admin views ----------

function buildAdminBreadcrumb_(label, rightContent) {
  const wrap = document.createElement('div');
  wrap.className = 'admin-breadcrumb';
  const back = document.createElement('a');
  back.className = 'admin-breadcrumb__back';
  back.textContent = '← Admin';
  back.href = '#/admin/roster';
  wrap.appendChild(back);
  const sep = document.createElement('span');
  sep.className = 'admin-breadcrumb__sep';
  sep.textContent = ' / ';
  wrap.appendChild(sep);
  const here = document.createElement('span');
  here.className = 'admin-breadcrumb__current';
  here.textContent = label;
  wrap.appendChild(here);
  if (rightContent) {
    const right = document.createElement('div');
    right.className = 'admin-breadcrumb__right';
    right.appendChild(rightContent);
    wrap.appendChild(right);
  }
  return wrap;
}
</script>
```

- [ ] **Step 6: Add admin nav + modal CSS to `console_css.html`**

In `apps-script/src/console_css.html`, append at the bottom (before the closing `</style>` if present, or just at end of file):

```css
/* ============================================================
   Admin area — nav + shared modal styles
   ============================================================ */

.console-header__right {
  display: flex;
  gap: 16px;
  align-items: center;
}

.console-header__admin {
  position: relative;
}

.console-header__admin-btn {
  background: transparent;
  border: 1px solid rgba(255,255,255,0.4);
  color: #fff;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font: inherit;
}
.console-header__admin-btn:hover {
  background: rgba(255,255,255,0.1);
}

.console-header__admin-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 6px;
  min-width: 200px;
  background: #fff;
  color: #202124;
  border: 1px solid #dadce0;
  border-radius: 6px;
  box-shadow: 0 6px 16px rgba(0,0,0,0.15);
  display: none;
  z-index: 100;
}
.console-header__admin-menu--open {
  display: block;
}
.console-header__admin-item {
  display: block;
  width: 100%;
  background: transparent;
  border: 0;
  text-align: left;
  padding: 10px 16px;
  cursor: pointer;
  font: inherit;
}
.console-header__admin-item:hover {
  background: #f1f3f4;
}

/* Admin breadcrumb */
.admin-breadcrumb {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 16px 0 12px;
  font-size: 14px;
  color: #5f6368;
}
.admin-breadcrumb__back {
  color: #2d3f89;
  text-decoration: none;
}
.admin-breadcrumb__back:hover { text-decoration: underline; }
.admin-breadcrumb__sep { color: #9aa0a6; }
.admin-breadcrumb__current { color: #202124; font-weight: 500; }
.admin-breadcrumb__right { margin-left: auto; }

/* Modal overlay (shared with typed-confirm + plain confirm) */
.admin-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(32, 33, 36, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.admin-modal {
  background: #fff;
  border-radius: 8px;
  width: 480px;
  max-width: calc(100vw - 32px);
  box-shadow: 0 12px 32px rgba(0,0,0,0.2);
  font-family: 'Roboto', sans-serif;
}
.admin-modal--typed { width: 540px; }
.admin-modal__header {
  font-family: 'Lexend', sans-serif;
  font-weight: 600;
  font-size: 18px;
  padding: 20px 24px 12px;
  color: #202124;
}
.admin-modal__body {
  padding: 0 24px 16px;
  font-size: 14px;
  color: #3c4043;
  line-height: 1.5;
}
.admin-modal__body code { background: #f1f3f4; padding: 1px 4px; border-radius: 3px; font-size: 13px; }
.admin-modal__phrase {
  padding: 4px 24px 8px;
  font-size: 13px;
  color: #5f6368;
}
.admin-modal__phrase code {
  background: #e8eaed;
  padding: 2px 6px;
  border-radius: 3px;
  color: #ad2122;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.admin-modal__input {
  display: block;
  width: calc(100% - 48px);
  margin: 4px 24px 16px;
  padding: 8px 10px;
  border: 1px solid #dadce0;
  border-radius: 4px;
  font: 14px 'Roboto Mono', monospace;
}
.admin-modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 24px 20px;
}
.admin-modal__cancel,
.admin-modal__primary,
.admin-modal__danger {
  padding: 8px 16px;
  border-radius: 4px;
  font: 500 14px 'Roboto', sans-serif;
  cursor: pointer;
  border: 0;
}
.admin-modal__cancel {
  background: transparent;
  color: #2d3f89;
  border: 1px solid #dadce0;
}
.admin-modal__cancel:hover { background: #f1f3f4; }
.admin-modal__primary {
  background: #2d3f89;
  color: #fff;
}
.admin-modal__primary:disabled {
  background: #c8cdd9; cursor: not-allowed;
}
.admin-modal__danger {
  background: #ad2122;
  color: #fff;
}
.admin-modal__danger:disabled {
  background: #e0a3a3; cursor: not-allowed;
}
```

- [ ] **Step 7: Push and confirm nav**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

In the browser, reload the Console at the Web App URL. Expected:
- As an admin, `Admin ▾` button appears in the header right.
- Clicking it shows the dropdown with Roster / Staff / Archive school year.
- Clicking each navigates to the matching hash; the stub message "coming in Task N" renders.
- As a teacher (test by setting your Staff Role to `teacher` temporarily, then revert), no `Admin ▾` shows up.

- [ ] **Step 8: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/console.html apps-script/src/console_js.html apps-script/src/admin_js.html apps-script/src/console_css.html
git commit -m "feat(admin): SPA scaffolding for admin views`n`nadmin_js.html loaded alongside console_js.html, sharing state/setStatus/onFail_/esc_/navigate_. Admin dropdown in header (admin-role only). Hash routes #/admin/{roster,staff,archive-year}. Shared typedConfirmModal_ and plainConfirmModal_ helpers. View bodies are stubs filled in by Tasks 14-17."
```

---

## Task 14: Admin Roster screen

**Model:** Sonnet — substantial UI work with inline editing + kebab menu + filters.

**Files:**
- Modify: `apps-script/src/admin_js.html` (replace `renderAdminRoster_` stub with full implementation)
- Modify: `apps-script/src/console_css.html` (append admin table styles)

- [ ] **Step 1: Replace `renderAdminRoster_` in `admin_js.html`**

In `apps-script/src/admin_js.html`, replace the `renderAdminRoster_` stub with this implementation. Append the helper functions below it.

```javascript
function renderAdminRoster_(main) {
  // Breadcrumb + actions
  const importBtn = document.createElement('button');
  importBtn.className = 'admin-btn-secondary';
  importBtn.textContent = '⤓ Import roster…';
  importBtn.addEventListener('click', openRosterImportDialog_);
  const addBtn = document.createElement('button');
  addBtn.className = 'admin-btn-primary';
  addBtn.textContent = '+ Add student';
  addBtn.style.marginLeft = '8px';
  addBtn.addEventListener('click', openAddStudentModal_);
  const actions = document.createElement('div');
  actions.appendChild(importBtn);
  actions.appendChild(addBtn);

  main.appendChild(buildAdminBreadcrumb_('Roster', actions));

  // Filter bar
  const filterBar = document.createElement('div');
  filterBar.className = 'admin-filter-bar';

  const search = document.createElement('input');
  search.type = 'text';
  search.placeholder = 'Search name, email, or ID';
  search.className = 'admin-search';
  search.value = adminRoster.search;
  search.addEventListener('input', () => {
    adminRoster.search = search.value;
    renderRosterTable_(tableHost);
  });
  filterBar.appendChild(search);

  const classSel = document.createElement('select');
  classSel.className = 'admin-filter-select';
  filterBar.appendChild(labeled_('Class', classSel));

  const teacherSel = document.createElement('select');
  teacherSel.className = 'admin-filter-select';
  filterBar.appendChild(labeled_('Teacher', teacherSel));

  const count = document.createElement('div');
  count.className = 'admin-filter-count';
  filterBar.appendChild(count);

  main.appendChild(filterBar);

  const tableHost = document.createElement('div');
  tableHost.className = 'admin-table-host';
  main.appendChild(tableHost);

  // Initial load
  if (adminRoster.rows === null) {
    tableHost.innerHTML = '<div class="admin-skeleton">Loading roster…</div>';
    google.script.run
      .withSuccessHandler((resp) => {
        adminRoster.rows = resp.rows || [];
        populateFilterSelects_(classSel, teacherSel, () => renderRosterTable_(tableHost));
        renderRosterTable_(tableHost);
        count.textContent = adminRoster.rows.length + ' students';
      })
      .withFailureHandler(onFail_('loading roster'))
      .adminGetRoster();
  } else {
    populateFilterSelects_(classSel, teacherSel, () => renderRosterTable_(tableHost));
    renderRosterTable_(tableHost);
    count.textContent = adminRoster.rows.length + ' students';
  }
}

function labeled_(label, control) {
  const wrap = document.createElement('label');
  wrap.className = 'admin-filter-label';
  const sp = document.createElement('span');
  sp.textContent = label + ':';
  wrap.appendChild(sp);
  wrap.appendChild(control);
  return wrap;
}

function populateFilterSelects_(classSel, teacherSel, onChange) {
  const classes = ['All'].concat(distinct_(adminRoster.rows.map((r) => r.Class)).sort());
  const teachers = ['All'].concat(distinct_(adminRoster.rows.map((r) => r.Teacher)).sort());
  fillSelect_(classSel, classes, adminRoster.classFilter);
  fillSelect_(teacherSel, teachers, adminRoster.teacherFilter);
  classSel.addEventListener('change', () => { adminRoster.classFilter = classSel.value; onChange(); });
  teacherSel.addEventListener('change', () => { adminRoster.teacherFilter = teacherSel.value; onChange(); });
}

function distinct_(arr) {
  const seen = {};
  arr.forEach((v) => { if (v) seen[v] = true; });
  return Object.keys(seen);
}

function fillSelect_(sel, values, selected) {
  sel.innerHTML = '';
  values.forEach((v) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    if (v === selected) o.selected = true;
    sel.appendChild(o);
  });
}

function renderRosterTable_(host) {
  host.innerHTML = '';
  const filtered = filterAndSortRoster_(adminRoster.rows);
  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'console-empty';
    empty.textContent = adminRoster.rows.length === 0
      ? 'No roster rows yet. Click + Add student or Import roster to get started.'
      : 'No rows match the current filters.';
    host.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'admin-table';
  const thead = document.createElement('thead');
  thead.appendChild(buildRosterHeader_(host));
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  filtered.forEach((r) => tbody.appendChild(buildRosterRow_(r, host)));
  table.appendChild(tbody);
  host.appendChild(table);
}

function buildRosterHeader_(host) {
  const tr = document.createElement('tr');
  const cols = [
    { label: 'ID',        sortKey: 'ID' },
    { label: 'Name',      sortKey: 'Last' },
    { label: 'Email',     sortKey: 'Email' },
    { label: 'Class',     sortKey: 'Class' },
    { label: 'Teacher',   sortKey: 'Teacher' },
    { label: '',          sortKey: null },   // kebab
  ];
  cols.forEach((c) => {
    const th = document.createElement('th');
    th.textContent = c.label;
    if (c.sortKey) {
      th.classList.add('admin-table__sortable');
      th.addEventListener('click', () => {
        if (adminRoster.sort.column === c.sortKey) {
          adminRoster.sort.dir = adminRoster.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          adminRoster.sort.column = c.sortKey;
          adminRoster.sort.dir = 'asc';
        }
        renderRosterTable_(host);
      });
      if (adminRoster.sort.column === c.sortKey) {
        th.classList.add(adminRoster.sort.dir === 'asc' ? 'admin-table__sort-asc' : 'admin-table__sort-desc');
      }
    }
    tr.appendChild(th);
  });
  return tr;
}

function filterAndSortRoster_(rows) {
  const q = adminRoster.search.toLowerCase().trim();
  let out = rows.slice();
  if (q) {
    out = out.filter((r) => {
      return (r.First + ' ' + r.Last + ' ' + r.Email + ' ' + r.ID).toLowerCase().indexOf(q) >= 0;
    });
  }
  if (adminRoster.classFilter && adminRoster.classFilter !== 'All') {
    out = out.filter((r) => r.Class === adminRoster.classFilter);
  }
  if (adminRoster.teacherFilter && adminRoster.teacherFilter !== 'All') {
    out = out.filter((r) => r.Teacher === adminRoster.teacherFilter);
  }
  const col = adminRoster.sort.column;
  const dir = adminRoster.sort.dir === 'asc' ? 1 : -1;
  out.sort((a, b) => String(a[col] || '').localeCompare(String(b[col] || '')) * dir);
  return out;
}

function buildRosterRow_(r, host) {
  const tr = document.createElement('tr');
  tr.dataset.email = r.Email;

  tr.appendChild(buildIdCell_(r, host));

  const nameCell = document.createElement('td');
  nameCell.className = 'admin-table__name';
  const lastCell = inlineEditCell_('Last', r);
  const firstCell = inlineEditCell_('First', r);
  nameCell.appendChild(lastCell);
  nameCell.appendChild(document.createTextNode(', '));
  nameCell.appendChild(firstCell);
  tr.appendChild(nameCell);

  // Email — NOT click-to-edit; opens typed-confirm.
  const emailCell = document.createElement('td');
  emailCell.className = 'admin-table__email';
  emailCell.textContent = r.Email;
  emailCell.addEventListener('click', () => openChangeEmailModal_(r));
  tr.appendChild(emailCell);

  tr.appendChild(inlineEditTd_('Class', r));
  tr.appendChild(inlineEditTd_('Teacher', r));

  // Kebab cell
  const kebabCell = document.createElement('td');
  kebabCell.className = 'admin-table__kebab';
  const kebab = document.createElement('button');
  kebab.className = 'admin-table__kebab-btn';
  kebab.textContent = '⋯';
  kebab.addEventListener('click', (e) => {
    e.stopPropagation();
    adminRoster.openMenuEmail = adminRoster.openMenuEmail === r.Email ? null : r.Email;
    renderRosterTable_(host);
  });
  kebabCell.appendChild(kebab);
  if (adminRoster.openMenuEmail === r.Email) {
    kebabCell.appendChild(buildRosterKebabMenu_(r, host));
  }
  tr.appendChild(kebabCell);

  return tr;
}

function buildIdCell_(r, host) {
  const td = document.createElement('td');
  td.className = 'admin-table__id';
  if (!r.ID) {
    const setBtn = document.createElement('button');
    setBtn.className = 'admin-link-btn';
    setBtn.textContent = 'Set ID';
    setBtn.addEventListener('click', () => openSetIdModal_(r, host));
    td.appendChild(document.createTextNode('— '));
    td.appendChild(setBtn);
  } else {
    td.textContent = r.ID;
  }
  return td;
}

function inlineEditTd_(field, r) {
  const td = document.createElement('td');
  td.appendChild(inlineEditCell_(field, r));
  return td;
}

function inlineEditCell_(field, r) {
  const span = document.createElement('span');
  span.className = 'admin-edit';
  span.textContent = r[field] || '';
  span.title = 'Click to edit';
  span.addEventListener('click', () => activateInlineEdit_(span, field, r));
  return span;
}

function activateInlineEdit_(span, field, r) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'admin-edit__input';
  input.value = span.textContent;
  span.replaceWith(input);
  input.focus();
  input.select();
  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const newVal = input.value;
    if (newVal === r[field]) {
      input.replaceWith(span); return;
    }
    const fields = {}; fields[field] = newVal;
    google.script.run
      .withSuccessHandler((resp) => {
        r[field] = resp.row[field];
        span.textContent = r[field] || '';
        input.replaceWith(span);
        setStatus('Saved.', 'good', 1500);
      })
      .withFailureHandler((e) => {
        setStatus('Update failed: ' + (e && e.message || e), 'bad', 4000);
        input.replaceWith(span);
      })
      .adminUpdateRosterRow(r.Email, fields);
  };
  const cancel = () => {
    committed = true;
    input.replaceWith(span);
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
}

function buildRosterKebabMenu_(r, host) {
  const menu = document.createElement('div');
  menu.className = 'admin-table__kebab-menu';
  const editEmail = document.createElement('button');
  editEmail.textContent = 'Edit email…';
  editEmail.addEventListener('click', (e) => { e.stopPropagation(); openChangeEmailModal_(r); });
  menu.appendChild(editEmail);

  if (r.ID) {
    const editId = document.createElement('button');
    editId.textContent = 'Change ID…';
    editId.addEventListener('click', (e) => { e.stopPropagation(); openChangeIdModal_(r, host); });
    menu.appendChild(editId);
  }

  const del = document.createElement('button');
  del.className = 'admin-table__kebab-danger';
  del.textContent = 'Delete row…';
  del.addEventListener('click', (e) => { e.stopPropagation(); openDeleteRowModal_(r, host); });
  menu.appendChild(del);
  return menu;
}

// ---------- Roster modals ----------

function openAddStudentModal_() {
  const overlay = document.createElement('div');
  overlay.className = 'admin-modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'admin-modal';
  modal.innerHTML = `
    <div class="admin-modal__header">Add student</div>
    <div class="admin-modal__form">
      <label>ID (optional)<input data-field="ID" type="text"></label>
      <label>First<input data-field="First" type="text" required></label>
      <label>Last<input data-field="Last" type="text" required></label>
      <label>Email<input data-field="Email" type="email" required></label>
      <label>Class<input data-field="Class" type="text" required></label>
      <label>Teacher (display)<input data-field="Teacher" type="text"></label>
      <label>Teacher Email<input data-field="TeacherEmail" type="email" required></label>
    </div>
    <div class="admin-modal__actions">
      <button class="admin-modal__cancel">Cancel</button>
      <button class="admin-modal__primary" disabled>Add student</button>
    </div>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const inputs = modal.querySelectorAll('input[data-field]');
  const primary = modal.querySelector('.admin-modal__primary');
  const checkValid = () => {
    let ok = true;
    inputs.forEach((i) => { if (i.required && !i.value.trim()) ok = false; });
    primary.disabled = !ok;
  };
  inputs.forEach((i) => i.addEventListener('input', checkValid));

  const close = () => overlay.parentNode && overlay.parentNode.removeChild(overlay);
  modal.querySelector('.admin-modal__cancel').addEventListener('click', close);
  primary.addEventListener('click', () => {
    const row = {};
    inputs.forEach((i) => row[i.dataset.field] = i.value.trim());
    primary.disabled = true;
    primary.textContent = '…';
    google.script.run
      .withSuccessHandler((resp) => {
        adminRoster.rows.push(Object.assign({ hasWork: false }, resp.row));
        setStatus('Added.', 'good', 2000);
        close();
        applyHash_();   // re-render via hash to pick up new row
      })
      .withFailureHandler((e) => {
        primary.disabled = false;
        primary.textContent = 'Add student';
        setStatus(String(e && e.message || e), 'bad', 4000);
      })
      .adminAddRosterRow(row);
  });
}

function openSetIdModal_(r, host) {
  plainConfirmModal_({
    title: 'Set student ID',
    bodyHtml: `Set the SIS ID for <strong>${esc_(r.Last)}, ${esc_(r.First)}</strong>. Once set, changing it requires a typed confirm.<br><br><label class="admin-modal__form-row">ID:<input id="set-id-input" type="text" style="margin-left: 8px"></label>`,
    confirmLabel: 'Set ID',
    onConfirm: () => new Promise((resolve, reject) => {
      const val = (document.getElementById('set-id-input') || {}).value || '';
      if (!val.trim()) { reject(new Error('ID required')); return; }
      google.script.run
        .withSuccessHandler((resp) => {
          r.ID = resp.row.ID;
          renderRosterTable_(host);
          setStatus('ID set.', 'good', 2000);
          resolve();
        })
        .withFailureHandler((e) => reject(e))
        .adminSetStudentId(r.Email, val.trim());
    }),
  });
}

function openChangeIdModal_(r, host) {
  typedConfirmModal_({
    title: 'Change student ID?',
    bodyHtml: `<p>The current ID for <strong>${esc_(r.Last)}, ${esc_(r.First)}</strong> is <code>${esc_(r.ID)}</code>.</p>
               <label class="admin-modal__form-row">New ID:<input id="change-id-input" type="text" style="margin-left: 8px"></label>`,
    phrase: 'CHANGE ID',
    dangerLabel: 'Change ID',
    onConfirm: () => new Promise((resolve, reject) => {
      const val = (document.getElementById('change-id-input') || {}).value || '';
      if (!val.trim()) { reject(new Error('New ID required')); return; }
      google.script.run
        .withSuccessHandler((resp) => {
          r.ID = resp.row.ID;
          renderRosterTable_(host);
          setStatus('ID changed.', 'good', 2000);
          resolve();
        })
        .withFailureHandler((e) => reject(e))
        .adminChangeStudentId(r.Email, val.trim());
    }),
  });
}

function openChangeEmailModal_(r) {
  const workNote = r.hasWork
    ? `<p>This student has saved research. Changing their email will also:</p>
       <ul>
         <li>Rename their per-student Sheet(s) in every project</li>
         <li>Rewrite <code>createdByEmail</code> on every source + highlight row</li>
         <li>Rekey their saved active-project preference</li>
       </ul>`
    : `<p>This student has no saved research yet. Only the roster row and any active-project preference will change.</p>`;
  typedConfirmModal_({
    title: 'Change student email?',
    bodyHtml: `<p><strong>${esc_(r.Last)}, ${esc_(r.First)}</strong>'s email is <code>${esc_(r.Email)}</code>.</p>
               ${workNote}
               <label class="admin-modal__form-row">New email:<input id="change-email-input" type="email" style="margin-left: 8px"></label>`,
    phrase: 'CHANGE EMAIL',
    dangerLabel: 'Change email',
    onConfirm: () => new Promise((resolve, reject) => {
      const val = (document.getElementById('change-email-input') || {}).value || '';
      if (!val.trim()) { reject(new Error('New email required')); return; }
      google.script.run
        .withSuccessHandler(() => {
          setStatus('Email changed.', 'good', 2500);
          adminRoster.rows = null; // force refetch
          resolve();
          applyHash_();
        })
        .withFailureHandler((e) => reject(e))
        .adminChangeStudentEmail(r.Email, val.trim().toLowerCase());
    }),
  });
}

function openDeleteRowModal_(r, host) {
  if (!r.hasWork) {
    plainConfirmModal_({
      title: 'Delete roster row?',
      bodyHtml: `Remove <strong>${esc_(r.Last)}, ${esc_(r.First)}</strong> (${esc_(r.Email)}) from the roster?`,
      confirmLabel: 'Delete row',
      danger: true,
      onConfirm: () => new Promise((resolve, reject) => {
        google.script.run
          .withSuccessHandler(() => {
            adminRoster.rows = adminRoster.rows.filter((x) => x.Email !== r.Email);
            renderRosterTable_(host);
            setStatus('Deleted.', 'good', 2000);
            resolve();
          })
          .withFailureHandler((e) => reject(e))
          .adminDeleteRosterRow(r.Email);
      }),
    });
  } else {
    typedConfirmModal_({
      title: 'Delete roster row?',
      bodyHtml: `<p><strong>${esc_(r.Last)}, ${esc_(r.First)}</strong> has saved research in one or more projects.</p>
                 <p>Per-student Sheet(s) will be <strong>preserved</strong> — the data stays in Drive even after the roster row is removed.</p>`,
      phrase: 'DELETE ROW',
      dangerLabel: 'Delete row',
      onConfirm: () => new Promise((resolve, reject) => {
        google.script.run
          .withSuccessHandler(() => {
            adminRoster.rows = adminRoster.rows.filter((x) => x.Email !== r.Email);
            renderRosterTable_(host);
            setStatus('Deleted.', 'good', 2000);
            resolve();
          })
          .withFailureHandler((e) => reject(e))
          .adminDeleteRosterRow(r.Email);
      }),
    });
  }
}

// Stub for Task 15 — defined here so the import button compiles.
function openRosterImportDialog_() {
  setStatus('Import dialog coming in Task 15.', '', 2500);
}
```

- [ ] **Step 2: Append admin table styles to `console_css.html`**

Append at the bottom of `apps-script/src/console_css.html`:

```css
/* Admin tables (Roster + Staff share these) */
.admin-table-host { margin-top: 16px; }
.admin-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 14px;
}
.admin-table th, .admin-table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid #e8eaed;
  vertical-align: middle;
}
.admin-table th {
  font-family: 'Lexend', sans-serif;
  font-weight: 500;
  color: #5f6368;
  background: #f8f9fa;
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.5px;
}
.admin-table__sortable { cursor: pointer; user-select: none; }
.admin-table__sortable:hover { background: #f1f3f4; }
.admin-table__sort-asc::after  { content: ' ▴'; }
.admin-table__sort-desc::after { content: ' ▾'; }
.admin-table tbody tr:hover { background: #f8f9fa; }

.admin-table__id    { font-family: 'Roboto Mono', monospace; color: #5f6368; min-width: 80px; }
.admin-table__name  { font-weight: 500; min-width: 200px; }
.admin-table__email { font-family: 'Roboto Mono', monospace; color: #2d3f89; cursor: pointer; }
.admin-table__email:hover { text-decoration: underline; }
.admin-table__kebab { width: 40px; position: relative; }

.admin-table__kebab-btn {
  background: transparent;
  border: 0;
  font-size: 18px;
  cursor: pointer;
  color: #5f6368;
  padding: 4px 8px;
}
.admin-table__kebab-btn:hover { color: #202124; }
.admin-table__kebab-menu {
  position: absolute;
  right: 8px;
  top: 100%;
  min-width: 180px;
  background: #fff;
  border: 1px solid #dadce0;
  border-radius: 6px;
  box-shadow: 0 6px 16px rgba(0,0,0,0.15);
  z-index: 10;
}
.admin-table__kebab-menu button {
  display: block;
  width: 100%;
  background: transparent;
  border: 0;
  text-align: left;
  padding: 10px 14px;
  cursor: pointer;
  font: inherit;
}
.admin-table__kebab-menu button:hover { background: #f1f3f4; }
.admin-table__kebab-danger { color: #ad2122; }

.admin-edit {
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  display: inline-block;
}
.admin-edit:hover { background: #fff8c4; }
.admin-edit__input {
  font: inherit;
  padding: 2px 4px;
  border: 1px solid #2d3f89;
  border-radius: 3px;
  background: #fff;
  width: 100%;
}

/* Filter bar */
.admin-filter-bar {
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 8px 0 12px;
  border-bottom: 1px solid #e8eaed;
}
.admin-search {
  flex: 0 0 280px;
  padding: 6px 10px;
  border: 1px solid #dadce0;
  border-radius: 4px;
  font: 14px 'Roboto', sans-serif;
}
.admin-filter-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #5f6368;
}
.admin-filter-select {
  padding: 4px 8px;
  border: 1px solid #dadce0;
  border-radius: 4px;
  font: 14px 'Roboto', sans-serif;
  background: #fff;
}
.admin-filter-count {
  margin-left: auto;
  font-size: 13px;
  color: #5f6368;
}

/* Buttons */
.admin-btn-primary,
.admin-btn-secondary {
  padding: 8px 16px;
  border-radius: 4px;
  font: 500 14px 'Roboto', sans-serif;
  cursor: pointer;
  border: 0;
}
.admin-btn-primary { background: #2d3f89; color: #fff; }
.admin-btn-primary:hover { background: #1d2a5d; }
.admin-btn-secondary {
  background: transparent;
  color: #2d3f89;
  border: 1px solid #2d3f89;
}
.admin-btn-secondary:hover { background: #f0f3fc; }
.admin-link-btn {
  background: transparent;
  border: 0;
  color: #2d3f89;
  cursor: pointer;
  font: inherit;
  text-decoration: underline;
  padding: 0;
}

.admin-skeleton { padding: 40px; color: #5f6368; text-align: center; }

/* Add-student form */
.admin-modal__form {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  padding: 0 24px 16px;
}
.admin-modal__form label {
  display: flex;
  flex-direction: column;
  font-size: 13px;
  color: #5f6368;
}
.admin-modal__form input {
  padding: 8px 10px;
  font: 14px 'Roboto', sans-serif;
  border: 1px solid #dadce0;
  border-radius: 4px;
  margin-top: 2px;
}
.admin-modal__form-row {
  display: block;
  padding: 8px 24px;
}
.admin-modal__form-row input {
  padding: 6px 10px;
  border: 1px solid #dadce0;
  border-radius: 4px;
}
```

- [ ] **Step 3: Push and confirm**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

Reload the Console → click `Admin ▾` → `Roster`. Expected:
- Table renders all 7 columns (ID + composite Name + Email + Class + Teacher + kebab).
- Search box filters live.
- Class + Teacher dropdowns filter the table.
- Click First / Last / Class / Teacher cell → becomes an input; Enter saves; Esc cancels.
- Click Email cell → typed-confirm modal opens with the right blast-radius description.
- Kebab → menu with `Edit email…`, `Change ID…` (only if ID set), `Delete row…`.
- Add student modal → required field validation; submit → row appears.
- A row without an ID shows `— [Set ID]` link; clicking opens the set-ID modal.

- [ ] **Step 4: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/admin_js.html apps-script/src/console_css.html
git commit -m "feat(admin): roster screen with inline edit, kebab menu, typed-confirm modals`n`nTable with all 7 columns, search + class + teacher filters, sortable headers. Inline edit for First/Last/Class/Teacher (commit on blur, Esc cancels). Email cell + 'Edit email...' kebab open the typed-confirm modal. Add student modal. Set/Change ID flow. Delete row uses typed-confirm if hasWork, plain confirm otherwise."
```

---

## Task 15: Bulk roster import dialog (TSV + wizard modes)

**Model:** Sonnet — two-mode dialog with diff preview.

**Files:**
- Modify: `apps-script/src/admin_js.html` (replace `openRosterImportDialog_` stub with full implementation)
- Modify: `apps-script/src/console_css.html` (append import-dialog styles)

- [ ] **Step 1: Replace the stub in `admin_js.html`**

In `apps-script/src/admin_js.html`, replace the `openRosterImportDialog_` stub at the bottom with:

```javascript
function openRosterImportDialog_() {
  const overlay = document.createElement('div');
  overlay.className = 'admin-modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'admin-modal admin-modal--import';

  const head = document.createElement('div');
  head.className = 'admin-modal__header';
  head.textContent = 'Import roster';
  modal.appendChild(head);

  // Mode toggle
  const modeBar = document.createElement('div');
  modeBar.className = 'admin-import__modebar';
  const tsvBtn = document.createElement('button');
  tsvBtn.textContent = 'Paste all columns (TSV)';
  tsvBtn.className = 'admin-import__mode-active';
  const wizardBtn = document.createElement('button');
  wizardBtn.textContent = 'Paste columns separately';
  modeBar.appendChild(tsvBtn);
  modeBar.appendChild(wizardBtn);
  modal.appendChild(modeBar);

  const bodyHost = document.createElement('div');
  bodyHost.className = 'admin-import__body';
  modal.appendChild(bodyHost);

  const previewHost = document.createElement('div');
  previewHost.className = 'admin-import__preview';
  modal.appendChild(previewHost);

  const actions = document.createElement('div');
  actions.className = 'admin-modal__actions';
  const cancel = document.createElement('button');
  cancel.className = 'admin-modal__cancel';
  cancel.textContent = 'Cancel';
  const previewBtn = document.createElement('button');
  previewBtn.className = 'admin-modal__primary';
  previewBtn.textContent = 'Preview diff';
  const replaceBtn = document.createElement('button');
  replaceBtn.className = 'admin-modal__danger';
  replaceBtn.textContent = 'Replace roster';
  replaceBtn.disabled = true;
  actions.appendChild(cancel);
  actions.appendChild(previewBtn);
  actions.appendChild(replaceBtn);
  modal.appendChild(actions);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const close = () => overlay.parentNode && overlay.parentNode.removeChild(overlay);
  cancel.addEventListener('click', close);

  // State for current mode + parsed rows + preview result
  const ctx = { mode: 'tsv', rows: null, preview: null };

  tsvBtn.addEventListener('click', () => {
    ctx.mode = 'tsv';
    tsvBtn.className = 'admin-import__mode-active';
    wizardBtn.className = '';
    renderTsvMode_(bodyHost, ctx, () => { previewBtn.disabled = !ctx.rows; });
  });
  wizardBtn.addEventListener('click', () => {
    ctx.mode = 'wizard';
    wizardBtn.className = 'admin-import__mode-active';
    tsvBtn.className = '';
    renderWizardMode_(bodyHost, ctx, () => { previewBtn.disabled = !ctx.rows; });
  });

  // Default to TSV
  renderTsvMode_(bodyHost, ctx, () => { previewBtn.disabled = !ctx.rows; });

  previewBtn.addEventListener('click', () => {
    if (!ctx.rows) { setStatus('Paste rows first.', 'bad', 2500); return; }
    previewBtn.disabled = true;
    previewBtn.textContent = '…';
    google.script.run
      .withSuccessHandler((resp) => {
        ctx.preview = resp;
        renderPreview_(previewHost, resp);
        replaceBtn.disabled = (resp.errors.length > 0);
        previewBtn.disabled = false;
        previewBtn.textContent = 'Preview diff';
      })
      .withFailureHandler((e) => {
        previewBtn.disabled = false;
        previewBtn.textContent = 'Preview diff';
        setStatus(String(e && e.message || e), 'bad', 4000);
      })
      .adminPreviewReplaceRoster(ctx.rows);
  });

  replaceBtn.addEventListener('click', () => {
    if (!ctx.rows) return;
    replaceBtn.disabled = true;
    replaceBtn.textContent = '…';
    google.script.run
      .withSuccessHandler(() => {
        setStatus('Roster replaced.', 'good', 3000);
        adminRoster.rows = null;
        close();
        applyHash_();
      })
      .withFailureHandler((e) => {
        replaceBtn.disabled = false;
        replaceBtn.textContent = 'Replace roster';
        setStatus(String(e && e.message || e), 'bad', 4000);
      })
      .adminReplaceRoster(ctx.rows);
  });
}

function renderTsvMode_(host, ctx, onChange) {
  host.innerHTML = '';
  const help = document.createElement('div');
  help.className = 'admin-import__help';
  help.innerHTML = 'Paste a tab-separated block from Google Sheets. Header row optional. Required columns in this order:<br><code>ID&nbsp;&nbsp;First&nbsp;&nbsp;Last&nbsp;&nbsp;Email&nbsp;&nbsp;Class&nbsp;&nbsp;Teacher&nbsp;&nbsp;TeacherEmail</code>';
  host.appendChild(help);
  const ta = document.createElement('textarea');
  ta.className = 'admin-import__textarea';
  ta.rows = 14;
  ta.placeholder = '10234\tAlex\tSmith\tasmith@orono.k12.mn.us\t7A\tShogren\tbshogren@orono.k12.mn.us\n...';
  host.appendChild(ta);

  ta.addEventListener('input', () => {
    ctx.rows = parseTsv_(ta.value);
    onChange();
  });
}

function parseTsv_(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;
  // Skip header if first cell looks like 'ID' or 'First' (case-insensitive).
  const firstCell = String((lines[0].split('\t')[0] || '')).trim().toLowerCase();
  const start = (firstCell === 'id' || firstCell === 'first') ? 1 : 0;
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const c = lines[i].split('\t').map((s) => s.trim());
    while (c.length < 7) c.push('');
    out.push({
      ID:           c[0],
      First:        c[1],
      Last:         c[2],
      Email:        c[3],
      Class:        c[4],
      Teacher:      c[5],
      TeacherEmail: c[6],
    });
  }
  return out;
}

function renderWizardMode_(host, ctx, onChange) {
  host.innerHTML = '';
  const fields = ['ID', 'First', 'Last', 'Email', 'Class', 'Teacher', 'TeacherEmail'];
  const values = {};
  fields.forEach((f) => { values[f] = ''; });

  const step = { i: 0 };
  function rerender() {
    host.innerHTML = '';
    const f = fields[step.i];
    const label = document.createElement('div');
    label.className = 'admin-import__wizard-label';
    label.innerHTML = `Step <strong>${step.i + 1}</strong> of ${fields.length}: paste <code>${f}</code> column (one value per line)`;
    host.appendChild(label);

    const ta = document.createElement('textarea');
    ta.className = 'admin-import__textarea';
    ta.rows = 14;
    ta.value = values[f];
    ta.addEventListener('input', () => { values[f] = ta.value; });
    host.appendChild(ta);

    const nav = document.createElement('div');
    nav.className = 'admin-import__wizard-nav';
    const back = document.createElement('button');
    back.textContent = '← Back';
    back.className = 'admin-btn-secondary';
    back.disabled = step.i === 0;
    back.addEventListener('click', () => { step.i--; rerender(); });
    const next = document.createElement('button');
    next.className = 'admin-btn-primary';
    next.textContent = step.i === fields.length - 1 ? 'Done' : 'Next →';
    next.addEventListener('click', () => {
      // Validate row counts match.
      if (step.i === 0) {
        // first non-empty step sets the count
      }
      const lines0 = values[fields[0]].split(/\r?\n/).filter((l) => l.trim().length >= 0);
      const linesCur = values[f].split(/\r?\n/).filter((l) => l.trim().length >= 0);
      // ID column may be optional; allow blanks, but count must match other columns.
      if (step.i > 0 && linesCur.length !== lines0.length && fields[0] === 'ID') {
        // Use the first non-blank-required column (First) as the count source.
        const linesFirst = values['First'].split(/\r?\n/).filter((l) => l.trim().length >= 0);
        if (linesCur.length !== linesFirst.length) {
          setStatus(`Row count mismatch: ${f} has ${linesCur.length}, First has ${linesFirst.length}`, 'bad', 4000);
          return;
        }
      }
      step.i++;
      if (step.i >= fields.length) {
        ctx.rows = composeWizardRows_(values, fields);
        onChange();
      } else {
        rerender();
      }
    });
    nav.appendChild(back);
    nav.appendChild(next);
    host.appendChild(nav);
  }
  rerender();
}

function composeWizardRows_(values, fields) {
  // Use the longest non-empty column as the row count.
  let n = 0;
  fields.forEach((f) => {
    const lines = String(values[f] || '').split(/\r?\n/);
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (lines.length > n) n = lines.length;
  });
  const out = [];
  for (let i = 0; i < n; i++) {
    const row = {};
    fields.forEach((f) => {
      const lines = String(values[f] || '').split(/\r?\n/);
      row[f] = (lines[i] || '').trim();
    });
    out.push(row);
  }
  return out;
}

function renderPreview_(host, preview) {
  host.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'admin-import__preview-inner';
  if (preview.errors.length > 0) {
    const errHead = document.createElement('div');
    errHead.className = 'admin-import__errors-head';
    errHead.textContent = preview.errors.length + ' validation errors — fix and re-preview:';
    wrap.appendChild(errHead);
    const list = document.createElement('ul');
    list.className = 'admin-import__errors';
    preview.errors.slice(0, 50).forEach((e) => {
      const li = document.createElement('li');
      li.textContent = 'row ' + e.rowIndex + ': ' + e.error;
      list.appendChild(li);
    });
    wrap.appendChild(list);
  } else {
    const summary = document.createElement('div');
    summary.className = 'admin-import__summary';
    summary.innerHTML = `
      <span class="admin-import__added">${preview.added} added</span>
      <span class="admin-import__removed">${preview.removed} removed</span>
      <span class="admin-import__changed">${preview.changed} changed</span>
      <span class="admin-import__unchanged">${preview.unchanged} unchanged</span>
    `;
    wrap.appendChild(summary);
  }
  host.appendChild(wrap);
}
```

- [ ] **Step 2: Append import-dialog styles to `console_css.html`**

```css
/* Import roster dialog */
.admin-modal--import { width: 720px; max-width: calc(100vw - 32px); }
.admin-import__modebar {
  display: flex;
  gap: 4px;
  padding: 0 24px;
  border-bottom: 1px solid #e8eaed;
}
.admin-import__modebar button {
  background: transparent;
  border: 0;
  padding: 10px 16px;
  cursor: pointer;
  font: 14px 'Roboto', sans-serif;
  color: #5f6368;
  border-bottom: 2px solid transparent;
}
.admin-import__mode-active {
  color: #2d3f89 !important;
  border-bottom-color: #2d3f89 !important;
  font-weight: 500;
}
.admin-import__body { padding: 16px 24px; }
.admin-import__help { font-size: 13px; color: #5f6368; padding-bottom: 8px; }
.admin-import__help code { background: #f1f3f4; padding: 1px 4px; border-radius: 3px; }
.admin-import__textarea {
  width: 100%;
  font: 13px 'Roboto Mono', monospace;
  border: 1px solid #dadce0;
  border-radius: 4px;
  padding: 8px;
  box-sizing: border-box;
}
.admin-import__wizard-label { font-size: 14px; padding-bottom: 8px; color: #3c4043; }
.admin-import__wizard-label code { background: #f1f3f4; padding: 1px 4px; border-radius: 3px; }
.admin-import__wizard-nav { display: flex; justify-content: space-between; padding-top: 12px; }

.admin-import__preview { padding: 0 24px; min-height: 24px; }
.admin-import__summary {
  display: flex;
  gap: 16px;
  padding: 12px 0;
  font-size: 14px;
}
.admin-import__added    { color: #137333; }
.admin-import__removed  { color: #ad2122; }
.admin-import__changed  { color: #b06000; }
.admin-import__unchanged{ color: #5f6368; }

.admin-import__errors-head { color: #ad2122; font-weight: 500; padding: 8px 0 4px; }
.admin-import__errors {
  list-style: disc;
  padding-left: 24px;
  margin: 0;
  max-height: 200px;
  overflow-y: auto;
  font-size: 13px;
  color: #3c4043;
}
```

- [ ] **Step 3: Push and confirm**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

Reload Console → `Admin ▾` → `Roster` → click `⤓ Import roster…`. Test:
- Default TSV mode: paste a small block of 2-3 tab-separated rows in the 7-col order → click `Preview diff` → preview summary shows correct added/removed/changed counts.
- If preview has errors, the `Replace roster` button stays disabled.
- Click `Replace roster` on a clean preview → toast confirms, dialog closes, table refreshes.
- Toggle to wizard mode: 7-step Next/Back flow; row count mismatch surfaces toast and blocks Next.

- [ ] **Step 4: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/admin_js.html apps-script/src/console_css.html
git commit -m "feat(admin): bulk roster import dialog with TSV + wizard modes`n`nDefault is TSV paste; toggle to column-by-column wizard. Both feed adminPreviewReplaceRoster (diff summary + per-row errors) and adminReplaceRoster (atomic swap). Replace button stays disabled until preview is clean."
```

---

## Task 16: Admin Staff screen + Unarchive banner

**Model:** Sonnet — Staff is similar to Roster but smaller; banner is a small dashboard tweak that pairs naturally.

**Files:**
- Modify: `apps-script/src/admin_js.html` (replace `renderAdminStaff_` stub)
- Modify: `apps-script/src/console_js.html` (extend `renderDashboard_` to show banner)
- Modify: `apps-script/src/console_css.html` (banner styles)

- [ ] **Step 1: Replace `renderAdminStaff_` in `admin_js.html`**

In `apps-script/src/admin_js.html`, replace the `renderAdminStaff_` stub with:

```javascript
function renderAdminStaff_(main) {
  const addBtn = document.createElement('button');
  addBtn.className = 'admin-btn-primary';
  addBtn.textContent = '+ Add staff';
  addBtn.addEventListener('click', openAddStaffModal_);

  main.appendChild(buildAdminBreadcrumb_('Staff', addBtn));

  const tableHost = document.createElement('div');
  tableHost.className = 'admin-table-host';
  main.appendChild(tableHost);

  if (adminStaff.rows === null) {
    tableHost.innerHTML = '<div class="admin-skeleton">Loading staff…</div>';
    google.script.run
      .withSuccessHandler((resp) => {
        adminStaff.rows = resp.rows || [];
        renderStaffTable_(tableHost);
      })
      .withFailureHandler(onFail_('loading staff'))
      .adminGetStaff();
  } else {
    renderStaffTable_(tableHost);
  }
}

function renderStaffTable_(host) {
  host.innerHTML = '';
  if (adminStaff.rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'console-empty';
    empty.textContent = 'No staff rows yet. Click + Add staff to get started.';
    host.appendChild(empty);
    return;
  }
  const adminCount = adminStaff.rows.filter((r) => r.Role === 'admin').length;

  const table = document.createElement('table');
  table.className = 'admin-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  adminStaff.rows.forEach((r) => tbody.appendChild(buildStaffRow_(r, host, adminCount)));
  table.appendChild(tbody);
  host.appendChild(table);
}

function buildStaffRow_(r, host, adminCount) {
  const isOnlyAdmin = (r.Role === 'admin' && adminCount === 1);

  const tr = document.createElement('tr');
  tr.dataset.email = r.Email;

  // Name — inline edit
  const nameTd = document.createElement('td');
  nameTd.appendChild(inlineEditStaffCell_('Name', r));
  tr.appendChild(nameTd);

  // Email — typed-confirm modal
  const emailTd = document.createElement('td');
  emailTd.className = 'admin-table__email';
  emailTd.textContent = r.Email;
  emailTd.addEventListener('click', () => openChangeStaffEmailModal_(r));
  tr.appendChild(emailTd);

  // Role — dropdown cell
  const roleTd = document.createElement('td');
  roleTd.appendChild(buildRoleCell_(r, host, isOnlyAdmin));
  tr.appendChild(roleTd);

  // Kebab
  const kebabTd = document.createElement('td');
  kebabTd.className = 'admin-table__kebab';
  const kebab = document.createElement('button');
  kebab.className = 'admin-table__kebab-btn';
  kebab.textContent = '⋯';
  kebab.addEventListener('click', (e) => {
    e.stopPropagation();
    adminStaff.openMenuEmail = adminStaff.openMenuEmail === r.Email ? null : r.Email;
    renderStaffTable_(host);
  });
  kebabTd.appendChild(kebab);
  if (adminStaff.openMenuEmail === r.Email) {
    const menu = document.createElement('div');
    menu.className = 'admin-table__kebab-menu';
    const editEmail = document.createElement('button');
    editEmail.textContent = 'Change email…';
    editEmail.addEventListener('click', (e) => { e.stopPropagation(); openChangeStaffEmailModal_(r); });
    menu.appendChild(editEmail);
    const del = document.createElement('button');
    del.className = 'admin-table__kebab-danger';
    del.textContent = 'Delete row…';
    if (isOnlyAdmin) {
      del.disabled = true;
      del.title = 'Cannot remove the only admin';
    } else {
      del.addEventListener('click', (e) => { e.stopPropagation(); openDeleteStaffModal_(r, host); });
    }
    menu.appendChild(del);
    kebabTd.appendChild(menu);
  }
  tr.appendChild(kebabTd);

  return tr;
}

function inlineEditStaffCell_(field, r) {
  const span = document.createElement('span');
  span.className = 'admin-edit';
  span.textContent = r[field] || '';
  span.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'admin-edit__input';
    input.value = span.textContent;
    span.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      const newVal = input.value;
      if (newVal === r[field]) { input.replaceWith(span); return; }
      const fields = {}; fields[field] = newVal;
      google.script.run
        .withSuccessHandler((resp) => {
          r[field] = resp.row[field];
          span.textContent = r[field] || '';
          input.replaceWith(span);
          setStatus('Saved.', 'good', 1500);
        })
        .withFailureHandler((e) => {
          setStatus(String(e && e.message || e), 'bad', 4000);
          input.replaceWith(span);
        })
        .adminUpdateStaffRow(r.Email, fields);
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { done = true; input.replaceWith(span); }
    });
  });
  return span;
}

function buildRoleCell_(r, host, isOnlyAdmin) {
  const sel = document.createElement('select');
  sel.className = 'admin-staff__role';
  ['teacher', 'admin'].forEach((role) => {
    const o = document.createElement('option');
    o.value = role; o.textContent = role;
    if (role === r.Role) o.selected = true;
    sel.appendChild(o);
  });
  if (isOnlyAdmin) {
    sel.disabled = true;
    sel.title = 'Cannot demote the only admin';
  }
  sel.addEventListener('change', () => {
    if (sel.value === r.Role) return;
    google.script.run
      .withSuccessHandler((resp) => {
        r.Role = resp.row.Role;
        setStatus('Role updated.', 'good', 2000);
        renderStaffTable_(host);
      })
      .withFailureHandler((e) => {
        sel.value = r.Role;
        setStatus(String(e && e.message || e), 'bad', 4000);
      })
      .adminUpdateStaffRow(r.Email, { Role: sel.value });
  });
  return sel;
}

// ---------- Staff modals ----------

function openAddStaffModal_() {
  const overlay = document.createElement('div');
  overlay.className = 'admin-modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'admin-modal';
  modal.innerHTML = `
    <div class="admin-modal__header">Add staff</div>
    <div class="admin-modal__form">
      <label>Name<input data-field="Name" type="text" required></label>
      <label>Email<input data-field="Email" type="email" required></label>
      <label>Role
        <select data-field="Role">
          <option value="teacher">teacher</option>
          <option value="admin">admin</option>
        </select>
      </label>
    </div>
    <div class="admin-modal__actions">
      <button class="admin-modal__cancel">Cancel</button>
      <button class="admin-modal__primary" disabled>Add staff</button>
    </div>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const inputs = modal.querySelectorAll('input[data-field], select[data-field]');
  const primary = modal.querySelector('.admin-modal__primary');
  const check = () => {
    let ok = true;
    inputs.forEach((i) => { if (i.required && !i.value.trim()) ok = false; });
    primary.disabled = !ok;
  };
  inputs.forEach((i) => i.addEventListener('input', check));
  const close = () => overlay.parentNode && overlay.parentNode.removeChild(overlay);
  modal.querySelector('.admin-modal__cancel').addEventListener('click', close);
  primary.addEventListener('click', () => {
    const row = {};
    inputs.forEach((i) => row[i.dataset.field] = i.value.trim());
    primary.disabled = true;
    primary.textContent = '…';
    google.script.run
      .withSuccessHandler((resp) => {
        adminStaff.rows.push(resp.row);
        close();
        applyHash_();
        setStatus('Added.', 'good', 2000);
      })
      .withFailureHandler((e) => {
        primary.disabled = false;
        primary.textContent = 'Add staff';
        setStatus(String(e && e.message || e), 'bad', 4000);
      })
      .adminAddStaffRow(row);
  });
}

function openChangeStaffEmailModal_(r) {
  typedConfirmModal_({
    title: 'Change staff email?',
    bodyHtml: `<p><strong>${esc_(r.Name)}</strong>'s email is <code>${esc_(r.Email)}</code>.</p>
               <p>This changes the Staff sheet join key. The Roster's <code>TeacherEmail</code> column does NOT auto-update (separate join key, owned by the roster); roster updates are a separate action.</p>
               <label class="admin-modal__form-row">New email:<input id="change-staff-email-input" type="email" style="margin-left: 8px"></label>`,
    phrase: 'CHANGE EMAIL',
    dangerLabel: 'Change email',
    onConfirm: () => new Promise((resolve, reject) => {
      const val = (document.getElementById('change-staff-email-input') || {}).value || '';
      if (!val.trim()) { reject(new Error('New email required')); return; }
      google.script.run
        .withSuccessHandler(() => {
          adminStaff.rows = null;
          applyHash_();
          setStatus('Email changed.', 'good', 2500);
          resolve();
        })
        .withFailureHandler((e) => reject(e))
        .adminChangeStaffEmail(r.Email, val.trim().toLowerCase());
    }),
  });
}

function openDeleteStaffModal_(r, host) {
  plainConfirmModal_({
    title: 'Delete staff row?',
    bodyHtml: `Remove <strong>${esc_(r.Name)}</strong> (${esc_(r.Email)}) from the Staff sheet?`,
    confirmLabel: 'Delete row',
    danger: true,
    onConfirm: () => new Promise((resolve, reject) => {
      google.script.run
        .withSuccessHandler(() => {
          adminStaff.rows = adminStaff.rows.filter((x) => x.Email !== r.Email);
          renderStaffTable_(host);
          setStatus('Deleted.', 'good', 2000);
          resolve();
        })
        .withFailureHandler((e) => reject(e))
        .adminDeleteStaffRow(r.Email);
    }),
  });
}
```

- [ ] **Step 2: Extend `renderDashboard_` in `console_js.html` to show the banner**

In `apps-script/src/console_js.html`, locate `renderDashboard_` (search for `function renderDashboard_(`). Inside the existing success handler where the response is rendered, after the project header but before the students table is built, insert a banner if `resp.recentUnarchive` is present. Find the existing line that handles the success path of `consoleGetProjectDashboard` and add this snippet right after the project name is rendered (the exact location depends on the existing structure — look for where `data.project` is rendered and append the banner immediately below):

```javascript
function maybeRenderUnarchiveBanner_(main, data) {
  if (!data.recentUnarchive) return;
  const dismissedKey = 'dismissedUnarchive:' + data.recentUnarchive.eventId;
  if (localStorage.getItem(dismissedKey)) return;

  const banner = document.createElement('div');
  banner.className = 'unarchive-banner';

  const icon = document.createElement('span');
  icon.className = 'unarchive-banner__icon';
  icon.textContent = 'ⓘ';
  banner.appendChild(icon);

  const text = document.createElement('div');
  text.className = 'unarchive-banner__text';
  const when = new Date(data.recentUnarchive.at);
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateStr = monthNames[when.getMonth()] + ' ' + when.getDate() + ', ' + when.getFullYear();
  text.innerHTML =
    '<strong>This project was unarchived</strong> by ' +
    esc_(data.recentUnarchive.actor) + ' on ' + dateStr + '.<br>' +
    '<span class="unarchive-banner__sub">Students who had it set as active will need to re-select it.</span>';
  banner.appendChild(text);

  const close = document.createElement('button');
  close.className = 'unarchive-banner__close';
  close.textContent = '×';
  close.title = 'Dismiss';
  close.addEventListener('click', () => {
    localStorage.setItem(dismissedKey, '1');
    if (banner.parentNode) banner.parentNode.removeChild(banner);
  });
  banner.appendChild(close);

  main.appendChild(banner);
}
```

Add the function near the other dashboard helpers in `console_js.html`. Then in the existing `renderDashboard_` flow, immediately after the header row that shows project name + class list is appended to `main`, add the call:

```javascript
maybeRenderUnarchiveBanner_(main, data);
```

(If the existing dashboard render code uses a different variable name for the response, adapt accordingly. The banner should appear between the project header and the students table.)

- [ ] **Step 3: Append banner + staff role select styles to `console_css.html`**

```css
/* Unarchive banner on Project Dashboard */
.unarchive-banner {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  margin: 12px 0;
  background: #fff5e0;
  border: 1px solid #e7c068;
  border-left: 4px solid #b06000;
  border-radius: 4px;
  font-size: 14px;
  color: #3c4043;
}
.unarchive-banner__icon { color: #b06000; font-size: 16px; line-height: 1.4; }
.unarchive-banner__text { flex: 1; line-height: 1.5; }
.unarchive-banner__sub  { color: #5f6368; font-size: 13px; }
.unarchive-banner__close {
  background: transparent;
  border: 0;
  font-size: 18px;
  color: #5f6368;
  cursor: pointer;
  padding: 0 4px;
}
.unarchive-banner__close:hover { color: #202124; }

/* Staff role select */
.admin-staff__role {
  padding: 4px 8px;
  border: 1px solid transparent;
  background: transparent;
  font: 14px 'Roboto', sans-serif;
  border-radius: 3px;
  cursor: pointer;
}
.admin-staff__role:hover { border-color: #dadce0; background: #fff; }
.admin-staff__role:disabled { color: #5f6368; cursor: not-allowed; }
```

- [ ] **Step 4: Push and confirm**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

- `Admin ▾` → `Staff` → table renders Name / Email / Role / kebab.
- Inline-edit Name; role dropdown updates server; kebab > Change email opens typed-confirm.
- For a single-admin staff sheet, the role dropdown is disabled with a tooltip and Delete row is disabled.
- Trigger the banner: unarchive any project (already supported via My Projects kebab) → open that project's Dashboard → banner appears above the students table. Click `×` → banner disappears for that browser; reload confirms it stays dismissed (localStorage). After 7 days, server stops sending `recentUnarchive` even without dismissal.

- [ ] **Step 5: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/admin_js.html apps-script/src/console_js.html apps-script/src/console_css.html
git commit -m "feat(admin): staff screen + project dashboard unarchive banner`n`nStaff CRUD UI with inline edit on Name, role dropdown (disabled on only-admin), typed-confirm on email change, plain confirm on delete. Dashboard shows an amber banner when project was unarchived in the last 7 days; localStorage dismissal per (user, eventId)."
```

---

## Task 17: Archive School Year screen + final manual QA + push to prod

**Model:** Sonnet — Archive Year UI plus the final QA pass.

**Files:**
- Modify: `apps-script/src/admin_js.html` (replace `renderAdminLifecycle_` stub)
- Modify: `apps-script/src/console_css.html` (lifecycle screen styles)

- [ ] **Step 1: Replace `renderAdminLifecycle_` in `admin_js.html`**

```javascript
function renderAdminLifecycle_(main) {
  main.appendChild(buildAdminBreadcrumb_('Archive school year', null));

  const wrap = document.createElement('div');
  wrap.className = 'admin-lifecycle';
  main.appendChild(wrap);

  // Year picker
  const pickerRow = document.createElement('div');
  pickerRow.className = 'admin-lifecycle__picker';
  pickerRow.innerHTML = '<label>Pick a school year to archive:</label>';
  const sel = document.createElement('select');
  sel.className = 'admin-lifecycle__year';
  sel.disabled = true;
  pickerRow.appendChild(sel);
  wrap.appendChild(pickerRow);

  const previewHost = document.createElement('div');
  previewHost.className = 'admin-lifecycle__preview';
  wrap.appendChild(previewHost);

  const confirmHost = document.createElement('div');
  confirmHost.className = 'admin-lifecycle__confirm';
  wrap.appendChild(confirmHost);

  // Fetch years
  google.script.run
    .withSuccessHandler((resp) => {
      adminLifecycle.years = resp.years || [];
      sel.disabled = false;
      sel.innerHTML = '';
      if (adminLifecycle.years.length === 0) {
        const o = document.createElement('option');
        o.textContent = '— no active projects —';
        o.disabled = true;
        o.selected = true;
        sel.appendChild(o);
        previewHost.innerHTML = '<div class="console-empty">No active projects to archive.</div>';
        return;
      }
      adminLifecycle.years.forEach((y) => {
        const o = document.createElement('option');
        o.value = y; o.textContent = y;
        sel.appendChild(o);
      });
      sel.value = adminLifecycle.years[0];
      onPickYear_(sel.value, previewHost, confirmHost);
      sel.addEventListener('change', () => onPickYear_(sel.value, previewHost, confirmHost));
    })
    .withFailureHandler(onFail_('loading years'))
    .adminListArchivableYears();
}

function onPickYear_(year, previewHost, confirmHost) {
  adminLifecycle.selectedYear = year;
  adminLifecycle.preview = null;
  previewHost.innerHTML = '<div class="admin-skeleton">Loading…</div>';
  confirmHost.innerHTML = '';
  google.script.run
    .withSuccessHandler((resp) => {
      adminLifecycle.preview = resp;
      renderLifecyclePreview_(previewHost, resp);
      renderLifecycleConfirm_(confirmHost, year);
    })
    .withFailureHandler(onFail_('previewing year'))
    .adminPreviewArchiveYear(year);
}

function renderLifecyclePreview_(host, preview) {
  host.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'admin-lifecycle__head';
  head.textContent = preview.projects.length === 0
    ? 'No active projects for this year.'
    : 'This will affect ' + preview.projects.length + ' project' + (preview.projects.length === 1 ? '' : 's') + ':';
  host.appendChild(head);

  if (preview.projects.length === 0) return;

  const list = document.createElement('div');
  list.className = 'admin-lifecycle__list';
  preview.projects.forEach((p) => {
    const item = document.createElement('div');
    item.className = 'admin-lifecycle__item';
    const name = document.createElement('div');
    name.className = 'admin-lifecycle__name';
    name.textContent = p.name;
    const meta = document.createElement('div');
    meta.className = 'admin-lifecycle__meta';
    meta.textContent = p.memberClasses.join(', ') + ' · ' + p.studentCount + ' student' + (p.studentCount === 1 ? '' : 's');
    item.appendChild(name);
    item.appendChild(meta);
    list.appendChild(item);
  });
  host.appendChild(list);

  const explain = document.createElement('div');
  explain.className = 'admin-lifecycle__explain';
  explain.innerHTML = `
    <strong>For each project we will:</strong>
    <ul>
      <li>Flip status to <code>archived</code></li>
      <li>Move the project folder into <code>OPS Research Tool / Archived /</code></li>
      <li>Clear any student's saved active-project preference that points here</li>
    </ul>`;
  host.appendChild(explain);
}

function renderLifecycleConfirm_(host, year) {
  host.innerHTML = '';
  if (!adminLifecycle.preview || adminLifecycle.preview.projects.length === 0) return;

  const phrase = 'ARCHIVE ' + year;
  const label = document.createElement('div');
  label.className = 'admin-lifecycle__phrase-label';
  label.innerHTML = 'Type <code>' + esc_(phrase) + '</code> to confirm.';
  host.appendChild(label);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'admin-lifecycle__phrase-input';
  input.autocomplete = 'off';
  input.value = adminLifecycle.confirmText || '';
  host.appendChild(input);

  const actions = document.createElement('div');
  actions.className = 'admin-lifecycle__actions';
  const cancel = document.createElement('button');
  cancel.className = 'admin-btn-secondary';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => { input.value = ''; adminLifecycle.confirmText = ''; archiveBtn.disabled = true; });
  const archiveBtn = document.createElement('button');
  archiveBtn.className = 'admin-modal__danger';
  archiveBtn.textContent = 'Archive ' + adminLifecycle.preview.projects.length + ' project' + (adminLifecycle.preview.projects.length === 1 ? '' : 's');
  archiveBtn.disabled = (input.value !== phrase);

  input.addEventListener('input', () => {
    adminLifecycle.confirmText = input.value;
    archiveBtn.disabled = (input.value !== phrase);
  });

  archiveBtn.addEventListener('click', () => {
    archiveBtn.disabled = true;
    archiveBtn.textContent = '…';
    google.script.run
      .withSuccessHandler((resp) => {
        const arch = (resp.archived || []).length;
        const err = (resp.errors || []).length;
        const msg = arch + ' archived' + (err > 0 ? ', ' + err + ' had errors' : '') + '.';
        setStatus(msg, err > 0 ? 'bad' : 'good', 5000);
        if (err > 0) {
          renderLifecycleErrors_(host, resp.errors);
        } else {
          // Refresh.
          adminLifecycle.years = null;
          adminLifecycle.preview = null;
          adminLifecycle.confirmText = '';
          applyHash_();
        }
      })
      .withFailureHandler((e) => {
        archiveBtn.disabled = false;
        archiveBtn.textContent = 'Archive';
        setStatus(String(e && e.message || e), 'bad', 5000);
      })
      .adminArchiveSchoolYear(year, phrase);
  });

  actions.appendChild(cancel);
  actions.appendChild(archiveBtn);
  host.appendChild(actions);
}

function renderLifecycleErrors_(host, errors) {
  const wrap = document.createElement('div');
  wrap.className = 'admin-lifecycle__errors';
  const head = document.createElement('div');
  head.className = 'admin-lifecycle__errors-head';
  head.textContent = errors.length + ' projects had errors:';
  wrap.appendChild(head);
  const list = document.createElement('ul');
  errors.forEach((e) => {
    const li = document.createElement('li');
    li.textContent = (e.projectId || '?') + ' [' + e.step + ']: ' + e.error;
    list.appendChild(li);
  });
  wrap.appendChild(list);
  host.appendChild(wrap);
}
```

- [ ] **Step 2: Append lifecycle styles to `console_css.html`**

```css
.admin-lifecycle {
  max-width: 720px;
  padding: 16px 0;
}
.admin-lifecycle__picker {
  display: flex;
  gap: 12px;
  align-items: center;
  padding-bottom: 16px;
}
.admin-lifecycle__picker label {
  font-size: 14px;
  color: #3c4043;
}
.admin-lifecycle__year {
  padding: 6px 10px;
  font: 14px 'Roboto', sans-serif;
  border: 1px solid #dadce0;
  border-radius: 4px;
}
.admin-lifecycle__head {
  font-size: 14px;
  color: #3c4043;
  padding-bottom: 8px;
  font-weight: 500;
}
.admin-lifecycle__list {
  border: 1px solid #dadce0;
  border-radius: 6px;
  background: #f8f9fa;
}
.admin-lifecycle__item {
  padding: 12px 16px;
  border-bottom: 1px solid #e8eaed;
}
.admin-lifecycle__item:last-child { border-bottom: 0; }
.admin-lifecycle__name { font-weight: 500; }
.admin-lifecycle__meta { font-size: 13px; color: #5f6368; padding-top: 2px; }
.admin-lifecycle__explain {
  padding: 16px 0;
  font-size: 14px;
  color: #3c4043;
}
.admin-lifecycle__explain ul { margin: 8px 0 0 0; padding-left: 24px; }
.admin-lifecycle__explain code { background: #f1f3f4; padding: 1px 4px; border-radius: 3px; }

.admin-lifecycle__phrase-label { font-size: 14px; padding-bottom: 6px; }
.admin-lifecycle__phrase-label code {
  background: #e8eaed; padding: 2px 6px; border-radius: 3px;
  color: #ad2122; font-weight: 600; letter-spacing: 0.5px;
}
.admin-lifecycle__phrase-input {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #dadce0;
  border-radius: 4px;
  font: 14px 'Roboto Mono', monospace;
  box-sizing: border-box;
}
.admin-lifecycle__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 16px;
}
.admin-lifecycle__errors {
  margin-top: 16px;
  padding: 12px;
  border: 1px solid #e7c068;
  background: #fff5e0;
  border-radius: 4px;
}
.admin-lifecycle__errors-head { color: #b06000; font-weight: 500; padding-bottom: 6px; }
.admin-lifecycle__errors ul { margin: 0; padding-left: 24px; font-size: 13px; color: #3c4043; }
```

- [ ] **Step 3: Push and exercise the Archive Year flow**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

In the browser:
- `Admin ▾` → `Archive school year`.
- Year dropdown lists current active years.
- Pick a year → affected projects list appears with student counts.
- Confirm phrase input — typing `ARCHIVE <year>` enables the danger button; anything else keeps it disabled.
- Use a throwaway dev year (run `devSeedDevProject` first if needed) to actually fire it; observe toast, Drive folder move, and audit row(s) in the Audit tab of the Projects registry workbook.
- Unarchive one of the affected projects from `Admin ▾ → ... no wait`, the unarchive lives on My Projects (or rather any individual project's kebab). Go to My Projects → Archived → kebab → Unarchive. Then open that project's Dashboard → the amber `recentUnarchive` banner from Task 16 is now live (it reads from the audit row).

- [ ] **Step 4: Walk the manual QA matrix end-to-end**

This is the spec §12.2 checklist, executed by Paul. Do each item; tick the box only when observed working:

- [ ] Sign in as a teacher (non-admin) → no `Admin ▾` link in header.
- [ ] Sign in as an admin → `Admin ▾` link appears; dropdown lists Roster, Staff, Archive School Year.
- [ ] Roster screen: load → table renders with all 7 columns; class filter works; search works; click name cell → edit → save.
- [ ] Edit email of a row with work → typed-confirm modal lists per-student Sheet rewrites; wrong phrase keeps button disabled.
- [ ] Add a new student → appears in table.
- [ ] Bulk import: TSV paste → preview shows correct diff → confirm → swap.
- [ ] Bulk import: wizard mode → 7-step flow; mismatched row counts blocks Next.
- [ ] Staff screen: try to demote the only admin → server rejects, toast shows the exact guard message.
- [ ] Archive School Year: pick a year with 0 projects → confirm button disabled; copy shows "No active projects".
- [ ] Archive School Year: pick a year with N projects → list shows them; confirm phrase enforces exact match.
- [ ] After archive: open the project's URL hash → dashboard loads (read-only stays accessible).
- [ ] Unarchive a project → Drive folder restored from `Archived/`; banner appears on dashboard for next 7 days; dismissable; sticky on browser refresh.
- [ ] Open the Console as a non-staff user (incognito) → "Not authorized" panel; from devtools `google.script.run.adminGetRoster()` → server throws.

- [ ] **Step 5: Run the 5 sub-project C dev tests one more time**

In the GAS editor, run in order:
- `devTestAdminAuthGate`
- `devTestAdminRosterCrud`
- `devTestAdminRosterReplace`
- `devTestAdminEmailChange`
- `devTestArchiveSchoolYear`

All should print `ok: true`.

- [ ] **Step 6: Commit the lifecycle screen**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/admin_js.html apps-script/src/console_css.html
git commit -m "feat(admin): Archive School Year screen + final QA pass`n`nYear dropdown from adminListArchivableYears, preview from adminPreviewArchiveYear (project list + student counts), inline typed-confirm phrase 'ARCHIVE <year>'. adminArchiveSchoolYear returns per-project errors which the UI surfaces if any. Manual QA matrix walked end-to-end; 5 dev tests green."
```

- [ ] **Step 7: Push to main and let CI redeploy**

After Paul has reviewed all changes on the branch:

```powershell
cd C:\dev\ops-research-tool
git checkout main
git merge --no-ff feature/admin-area-lifecycle -m "Merge branch 'feature/admin-area-lifecycle'"
git push origin main
```

CI (`.github/workflows/deploy-apps-script.yml`) auto-redeploys the production Web App deployment (`AKfycbwaWJe2cbmS3C0-...`). Watch the Actions tab for the workflow run; expect green within ~2 minutes.

Confirm the production URL serves the new admin features:
- Open the production `/exec` URL in a browser.
- `Admin ▾` appears (for admin accounts).
- Run the 5 dev tests one final time against the deployed Web App.

---

## Spec coverage check

Each spec section maps to a task above:

| Spec section | Implemented in task(s) |
| --- | --- |
| §4 Architecture / file structure | Tasks 3, 4, 6, 13 (all new file creations) |
| §5 Authorization (`assertAdmin_`, server gate) | Task 2 (helper) + Task 6 onwards (called by every endpoint) |
| §6 Roster schema migration | Task 1 |
| §7 Admin Roster screen | Tasks 6 (read), 7 (CRUD), 8 (email change), 9 (bulk replace), 14 (UI), 15 (import dialog) |
| §8 Admin Staff screen | Task 10 (endpoints), Task 16 (UI) |
| §9 Archive School Year | Task 4 (lifecycle helpers), Task 11 (endpoints), Task 17 (UI) |
| §9.6 Symmetric single-project archive/unarchive | Task 5 |
| §10 Audit log | Task 3 (module), Task 11 (banner data on dashboard), Task 16 (banner UI) |
| §11 Modifications to existing files | Distributed across Tasks 1, 2, 5, 11, 13, 16 |
| §12 Testing (5 dev tests) | Task 12 |
| §12.2 Manual QA matrix | Task 17 Step 4 |
| §13 Out-of-scope / §14 reminders | Locked in the spec; no task needed |

No gaps.


