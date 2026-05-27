# Admin Area + Lifecycle (Phase 4 — Sub-project C)

**Date:** 2026-05-27
**Status:** Approved design — ready for implementation plan
**Scope:** Phase 4 sub-project C per `docs/build-plan.md` §5 and the merged
sub-projects A+B (`2026-05-27-teacher-console-design.md`). Adds the
admin-only surfaces to the Teacher Console: roster CRUD + bulk replace,
staff CRUD with last-admin guard, bulk Archive School Year, and a
server-side audit log feeding a per-project "recently unarchived" banner.

## 1. Problem

The Teacher Console (sub-projects A+B) is staff-gated but has no
admin-only surfaces. Today an admin who needs to fix a misspelled student
name, transfer a kid between classes, swap a teacher, or archive last
year's projects has to edit the underlying Google Sheets directly — and
project archive only flips the `status` cell, leaving Drive cluttered and
students' stored active-project pointers stale.

This spec covers the missing admin surfaces: roster management, staff
management, year-end project archival, and audit/notification of
lifecycle changes.

## 2. Goals

- An admin can fix a roster row (add, edit, transfer, change email,
  delete) without opening Google Sheets.
- An admin can replace the whole roster wholesale at the start of a
  school year via a single paste from the district SIS export.
- An admin can archive all projects from a given school year in one
  click, with a typed-confirm gate, while moving each project's Drive
  folder into an `Archived/` parent and clearing students' stale
  active-project preferences.
- Every archive/unarchive event is captured in a server-side audit log,
  and any project unarchived in the last 7 days shows a banner above its
  dashboard so teachers re-opening it know its lifecycle status changed.
- All admin surfaces are server-gated: a teacher (or student) crafting a
  manual `google.script.run.admin*` call is rejected with `'Admin only'`.

## 3. Non-goals

- **Group management** (create/merge/un-merge group Sheets, data
  migration). Sub-project D.
- **Bundle authoring** (UI to define new category bundles). Sub-project
  E.
- **Hard delete of student data.** Per build plan §"Lifecycle", a
  departed student's roster row can be removed but the per-student
  Sheet is preserved — the dead email becomes an inert key, the data
  and name remain available for the teacher.
- **Pre-archive activity check.** Bulk archive does not warn about
  recently-active students; the unarchive banner + audit log are the
  recovery path if the admin archives by mistake.
- **Student-facing email or push notification** on archive/unarchive.
  The extension already prompts when a stored active project is
  archived/invalid (build plan §"Active-project selector").
- **Audit log search / export / admin UI.** The log is server-side
  data; the only client surface that reads it is the unarchive banner.
  Direct inspection = open the Audit tab on the Projects registry.
- **Per-cell undo.** The risky-op guardrail is the typed-confirm
  modal, not undo plumbing.

## 4. Architecture

Single GAS web app deployment, same Script project as the existing
Console. The admin surfaces live alongside the existing My Projects /
Dashboard / Student views as additional SPA routes, served by an
adjacent JS partial (`admin_js.html`).

### Client structure — Approach 2 (split partial)

```
console.html
  ├─ console_css.html
  ├─ console_js.html      ← state machine, hash router, 3 teacher views, header
  └─ admin_js.html        ← NEW: 3 admin views, import dialog, all confirm modals
```

`console.html` includes both partials in `<head>`. They share the global
`state` object, `setStatus`, `onFail_`, `esc_`, and `navigate_` helpers
defined in `console_js.html`. `console_js.html`'s `renderView_` switch
gains three cases (`ADMIN_ROSTER`, `ADMIN_STAFF`, `ADMIN_LIFECYCLE`)
that delegate to render functions in `admin_js.html`.

### Server structure

```
apps-script/src/
  63_admin_api.js     ← NEW: admin* endpoints (roster CRUD, staff CRUD,
                          archive-year, all server-side guardrails)
  64_audit.js         ← NEW: appendAuditEvent_, latestUnarchiveFor_,
                          ensureAuditTab_
  65_lifecycle.js     ← NEW: archiveSchoolYear_, moveProjectToArchived_,
                          restoreProjectFromArchived_,
                          clearStaleActiveProjectPrefs_
  02_constants.js     ← MODIFIED: HEADERS.ROSTER becomes 7-col;
                          + HEADERS.AUDIT; + AUDIT_ACTIONS
  10_identity.js      ← MODIFIED: + assertAdmin_(actorEmail) helper
  12_projects.js      ← MODIFIED: archiveProject_/unarchiveProject_
                          extended to perform Drive move + pref clear
                          + audit append (called from both single-project
                          and bulk paths)
  61_console_api.js   ← MODIFIED: consoleGetProjectDashboard returns
                          `recentUnarchive`; listClassesTaughtBy_ joins
                          on TeacherEmail (not Teacher)
  99_dev.js           ← MODIFIED: + 5 new devTest* functions
```

### Hash routes added

- `#/admin/roster` → `ADMIN_ROSTER`
- `#/admin/staff` → `ADMIN_STAFF`
- `#/admin/archive-year` → `ADMIN_LIFECYCLE`

`parseHash_` gets a branch for `parts[0] === 'admin'`. `applyHash_`
treats unknown admin routes as `ADMIN_ROSTER` default.

## 5. Authorization

### Client-side gate (UX)

`buildHeader_` in `console_js.html` renders an `Admin ▾` link in the
right-side header **only when `state.ctx.role === 'admin'`**. The link
is a dropdown listing Roster, Staff, Archive School Year (navigates to
the respective hash route).

If a non-admin user hand-edits the URL to `#/admin/roster`, the route
parser still routes them through; the view's data fetch
(`adminGetRoster`) throws `'Admin only'`, and the standard
`onFail_('loading roster')` toast surfaces it. The admin views never
render data without a successful server fetch.

### Server-side gate (security)

New helper in `10_identity.js`:

```js
function assertAdmin_(actorEmail) {
  const staff = getStaffEntry_(actorEmail);
  if (!staff) throw new Error('Not authorized');
  if (staff.Role !== ROLES.ADMIN) throw new Error('Admin only');
  return staff;
}
```

Every `admin*` endpoint in `63_admin_api.js` calls
`assertAdmin_(getActorEmail_())` as the first statement. Teachers and
non-staff users are rejected before any data access.

## 6. Roster schema migration

`HEADERS.ROSTER` changes from 4 to 7 columns:

```js
HEADERS.ROSTER = [
  'ID',            // district SIS ID; immutable once set; future join key
  'First',
  'Last',
  'Email',         // canonical join key everywhere in the codebase
  'Class',
  'Teacher',       // display name only
  'TeacherEmail',  // join key for listClassesTaughtBy_
];
```

### Downstream code touched by the schema change

- `61_console_api.js` `listClassesTaughtBy_` (lines 32-43): joins on
  `String(r.TeacherEmail).trim().toLowerCase() === actorEmail.toLowerCase()`
  instead of `r.Teacher`.
- `11_provisioning.js` `findOrCreateStudentSheet_`: Meta tab's
  `studentName` is now `<Last>, <First>` (composed at provision time);
  `teacher` field on Meta gets the Teacher display name; no schema change
  to the Meta tab itself (still `HEADERS.META` with `teacher` column —
  populated from the new `Teacher` column).
- `10_identity.js` `validateRoster`: checks now include `First`, `Last`,
  `TeacherEmail` non-empty (and lowercase-emailness for `TeacherEmail`).
- The existing `Name` column is dropped. The previous "split on last
  space" Last-First rendering in `console_js.html` (build plan §Project
  Dashboard) becomes a direct read of `<Last>, <First>`.
- The old 4-column roster's existing rows are not migrated in code —
  the cutover is "re-paste the roster in the new 7-column shape via the
  bulk-import flow" (Section 7.2). The migration ships with sub-project
  C in one PR.

### Per-student Sheet `Meta` tab

No change to `HEADERS.META`. The `studentName` value written there
becomes the composed display string. Existing Meta rows are not
rewritten on schema migration — they're inert display strings and the
mismatch is harmless. (If we ever care, an admin tool can be added later.)

## 7. Admin Roster screen

Hash: `#/admin/roster`. View: `ADMIN_ROSTER`.

### 7.1 Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ OPS Research Tool                    Paul Ivers · admin · Admin ▾    │
├──────────────────────────────────────────────────────────────────────┤
│ ← Admin  /  Roster              [⤓ Import roster…]  [+ Add student]  │
│ ──────────────────────                                               │
│ [search...........] Class: [All ▾] Teacher: [All ▾]      217 students│
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ ID     NAME            EMAIL              CLASS  TEACHER  ⋯  │    │
│  │ 10234  Smith, Alex     asmith@orono...    7A     Shogren  ⋯  │    │
│  │ 10412  Johnson, Bri    bjohnson@orono...  7B     Shogren  ⋯  │    │
│  │ —      Park, Dev       dpark@orono...     7C     Jones    ⋯  │    │
│  │ ...                                              (no ID)      │    │
│  └──────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

A row without an ID renders a `—` placeholder + an inline `Set ID`
affordance on hover.

### 7.2 Interaction model

- `First`, `Last`, `Class`, `Teacher` cells are click-to-edit: cell
  becomes a text input. Blur or Enter commits via
  `adminUpdateRosterRow(email, fields)`. Esc cancels.
- `Email` cell is NOT click-to-edit; clicking opens the typed-confirm
  modal for `adminChangeStudentEmail` regardless of `hasWork`.
- `TeacherEmail` cell: click-to-edit + plain inline confirm if the
  change moves the student out of their current teacher's view.
- `ID` cell: not click-editable once set. If `—` (no ID), inline
  `Set ID` opens a small inline input; commit calls
  `adminSetStudentId(email, id)`. Setting an ID is one-way — to change
  a set ID later, kebab menu → `Change ID…` (typed-confirm, phrase
  `CHANGE ID`).
- Kebab `⋯` per row:
  - `Edit email…` (always typed-confirm)
  - `Change ID…` (only shown if ID is set; typed-confirm)
  - `Delete row…` (typed-confirm if `hasWork === true`; plain confirm
    otherwise)

Optimistic UI: edited cell shows a spinner ring; on error, revert + toast.

### 7.3 Risky-op typed-confirm modal

Shared shell takes `{title, body, confirmPhrase, dangerLabel, onConfirm}`
and renders the body, a typed-input requiring the exact `confirmPhrase`,
and Cancel / `<dangerLabel>` buttons. The danger button stays disabled
until the typed text matches exactly (case-sensitive).

Cases:

| Trigger | Phrase | Endpoint |
| --- | --- | --- |
| Edit email | `CHANGE EMAIL` | `adminChangeStudentEmail` |
| Change ID (already set) | `CHANGE ID` | `adminChangeStudentId` |
| Delete row when `hasWork` | `DELETE ROW` | `adminDeleteRosterRow` |

### 7.4 `hasWork` computation

`adminGetRoster` returns each row with a precomputed `hasWork: bool`.
Single server-side pass:

```
1. Build set { all email strings that name a Sheet file inside any
   class folder under any project root (active or archived) }.
2. For each roster row: hasWork = set.has(row.Email.toLowerCase()).
```

Walks every project's Drive folder once per page load. ~1s for a
~200-row roster across ~10 projects. Cache for the duration of the page
load only.

### 7.5 Add student

`[+ Add student]` opens a small modal with all 7 fields. Required:
`First`, `Last`, `Email` (lowercase, unique), `Class`. Optional: `ID`
(but if set on creation it's then locked), `Teacher`, `TeacherEmail`.
Submit → `adminAddRosterRow(row)`.

### 7.6 Bulk import roster (`[⤓ Import roster…]`)

Single dialog with a mode toggle:

**Default — TSV mode.** One textarea. Admin selects a range in the
source Google Sheet (any rows × 7 cols in `ID, First, Last, Email, Class,
Teacher, TeacherEmail` order), copies, pastes. Header row is detected
and skipped if present (first cell matches "ID" or "First"
case-insensitively). Parser splits on tab + newline.

**Alt — Column-by-column wizard.** 7-step `Next / Back` wizard. Each
step has one textarea (one value per line). Each step's row count must
match the first non-empty step's count; mismatch blocks `Next` with an
inline error. Order is fixed: ID, First, Last, Email, Class, Teacher,
TeacherEmail.

Both modes feed `adminPreviewReplaceRoster(rows)` which returns:

```js
{
  ok: true,
  added: 12,
  removed: 3,
  changed: 4,
  unchanged: 198,
  errors: [
    { rowIndex: 17, error: 'duplicate Email asmith@orono.k12.mn.us' },
    { rowIndex: 42, error: 'missing First' },
  ],
}
```

If `errors.length > 0`, the dialog shows them inline with row indices
and the confirm button stays disabled. If clean, the dialog shows the
diff summary and a `[Replace 217 rows]` confirm button. Confirm →
`adminReplaceRoster(rows)` performs the atomic swap (delete all current
rows, append all new rows in one batched operation).

The swap is destructive of the Roster tab's contents but never touches
per-student Sheets — student data lives independent of roster
membership. Removed-from-roster students' Sheets stay intact (matches
the `adminDeleteRosterRow` behavior).

### 7.7 Search + filters + sort

- Free-text search: case-insensitive substring over `First`, `Last`,
  `Email`, `ID`. Live (on keypress).
- Class filter: dropdown of distinct Class values + "All".
- Teacher filter: dropdown of distinct `Teacher` (display) values + "All".
- All filters client-side over the loaded `rows`.
- Column header click toggles asc/desc. Default sort: `Last` asc.

### 7.8 Empty / error states

- Roster empty (fresh install) → empty-state panel: "No roster rows
  yet. Click `+ Add student` or `⤓ Import roster` to get started."
- Load error → toast + retry button.

### 7.9 Server endpoints (in `63_admin_api.js`)

```js
adminGetRoster()
// → { ok, rows: [{ID, First, Last, Email, Class, Teacher, TeacherEmail, hasWork}] }

adminAddRosterRow(row)
// row: {ID?, First, Last, Email, Class, Teacher?, TeacherEmail?}
// → { ok, row }

adminUpdateRosterRow(email, fields)
// fields: any subset of {First, Last, Class, Teacher, TeacherEmail}
//   — NEVER Email, NEVER ID (those go through dedicated endpoints).
// → { ok, row }

adminSetStudentId(email, id)
// Only valid when ID is currently blank. Throws if already set.
// → { ok, row }

adminChangeStudentId(email, newId)
// Typed-confirm gated client-side; server validates uniqueness.
// → { ok, row }

adminChangeStudentEmail(oldEmail, newEmail)
// Atomic: rename roster row + rename per-student Sheet file (in EVERY
// project where one exists) + rewrite createdByEmail cells in Sources +
// Highlights + Meta of each + rekey ScriptProperties entries from
// `prefs:<oldEmail>:*` to `prefs:<newEmail>:*` (preserves
// activeProjectId selection across the rename).
// → { ok, oldEmail, newEmail, rewrittenCells: N, renamedSheets: N, rekeyedPrefs: N }

adminDeleteRosterRow(email)
// Removes roster row. Per-student Sheets preserved (data persists by
// design; dead email becomes inert key).
// → { ok, email, preservedSheets: [{projectId, sheetId}, ...] }

adminPreviewReplaceRoster(rows)
// Pure: parses + validates + diffs against current. Never mutates.
// → { ok, added, removed, changed, unchanged, errors }

adminReplaceRoster(rows)
// Atomic swap of the Roster tab's contents. Validates same as preview;
// rejects if any errors.
// → { ok, added, removed, changed, unchanged }
```

## 8. Admin Staff screen

Hash: `#/admin/staff`. View: `ADMIN_STAFF`.

### 8.1 Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ ← Admin  /  Staff                                  [+ Add staff]     │
│                                                                      │
│  NAME             EMAIL                       ROLE          ⋯         │
│  Paul Ivers       paul.ivers@orono.k12.mn.us  admin         ⋯         │
│  Brian Shogren    bshogren@orono.k12.mn.us    teacher       ⋯         │
│  ...                                                                  │
└──────────────────────────────────────────────────────────────────────┘
```

### 8.2 Schema

`HEADERS.STAFF = ['Name', 'Email', 'Role']` — unchanged.

### 8.3 Interaction model

- `Name` — click-to-edit, commit on blur.
- `Email` — typed-confirm modal (phrase `CHANGE EMAIL`); changes the
  join key for `getStaffEntry_`, `listClassesTaughtBy_`, audit log
  `actor`. The roster's `TeacherEmail` column does NOT auto-update
  (those are separate join keys, owned by the roster); roster updates
  are a separate admin action.
- `Role` — click cell → dropdown `teacher | admin`. Plain commit unless
  the change would be a last-admin demotion (server enforces; client
  pre-disables the admin → teacher option when the dropdown's row is
  the only admin).
- `Delete row` — plain confirm. Last-admin guard applies.

### 8.4 Last-admin guard

In `63_admin_api.js`:

```js
function ensureNotLastAdminRemoval_(targetEmail, newRole) {
  if (newRole === 'admin') return;
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const all = readAllAsObjects_(getTab_(ss, TABS.STAFF), HEADERS.STAFF);
  const admins = all.filter((r) => r.Role === ROLES.ADMIN);
  if (admins.length === 1 &&
      admins[0].Email.toLowerCase() === targetEmail.toLowerCase()) {
    throw new Error('Cannot remove the only admin — promote another staff member first');
  }
}
```

Called by `adminUpdateStaffRow` (when `Role` changes),
`adminChangeStaffEmail` (when the row being changed is the only admin),
and `adminDeleteStaffRow`.

### 8.5 No bulk import for Staff

The table is tiny (<20 rows in a district). Natural action is "add a
teacher when they show up." Out of scope for v1.

### 8.6 Server endpoints

```js
adminGetStaff()                       // → { ok, rows }
adminAddStaffRow(row)                 // row: {Name, Email, Role}; → { ok, row }
adminUpdateStaffRow(email, fields)    // fields: {Name?, Role?}; runs guard
adminChangeStaffEmail(oldEmail, newEmail)   // typed-confirm; runs guard
adminDeleteStaffRow(email)            // runs guard
```

## 9. Archive School Year

Hash: `#/admin/archive-year`. View: `ADMIN_LIFECYCLE`.

### 9.1 Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ ← Admin  /  Archive school year                                      │
│                                                                      │
│  Pick a school year to archive:    [2025-26 ▾]                       │
│                                                                      │
│  This will affect 4 projects:                                        │
│  ┌────────────────────────────────────────────────────────────┐      │
│  │ NHD 2026                        7A, 7B, 7C  · 58 students  │      │
│  │ Capstone 2026                   8A, 8B      · 41 students  │      │
│  │ AP Research Pilot               AP-R        · 6 students   │      │
│  │ NHD Sandbox                     7D          · 3 students   │      │
│  └────────────────────────────────────────────────────────────┘      │
│                                                                      │
│  For each project we will:                                           │
│   · Flip status to archived                                          │
│   · Move the project folder into "OPS Research Tool / Archived /"    │
│   · Clear any student's saved active-project pref that points here   │
│                                                                      │
│  Type ARCHIVE 2025-26 to confirm.                                    │
│  [                                                                ]  │
│                                                                      │
│                          [Cancel]   [Archive 4 projects] (disabled)  │
└──────────────────────────────────────────────────────────────────────┘
```

### 9.2 Year dropdown

`adminListArchivableYears()` returns distinct `schoolYear` values from
active projects, sorted descending. Empty → screen shows "No active
projects to archive."

### 9.3 Affected-projects fetch

`adminPreviewArchiveYear(schoolYear)` returns the active projects in
that year:

```js
{
  ok: true,
  schoolYear,
  projects: [{projectId, name, memberClasses, studentCount}],
}
```

`studentCount` is roster-side only (no per-Sheet opens).

### 9.4 Confirm phrase

Computed as `ARCHIVE <schoolYear>` (e.g., `ARCHIVE 2025-26`). Server
re-checks the phrase even though the client also enforces — defense in
depth.

### 9.5 Server flow per project

`adminArchiveSchoolYear(schoolYear, confirmPhrase)` calls, for each
matching active project, the same code path used by
`consoleArchiveProject` (which is extended in this spec to also do the
folder move + pref clear + audit append):

```
1. flipProjectStatus_(projectId, 'archived')      (cell write)
2. moveProjectToArchived_(project.rootFolderId)   (Drive move)
3. clearStaleActiveProjectPrefs_(projectId)       (user_prefs scan)
4. appendAuditEvent_({projectId, action: 'archive_year',
                      actor, at: nowIso_(),
                      detail: 'schoolYear=2025-26'})
```

Step 1 happens for ALL projects first (cheapest, just Sheet writes), so
status reflects intent quickly. Steps 2-4 are best-effort per project;
errors are caught and collected.

Return shape:

```js
{
  ok: true,
  schoolYear,
  archived: ['<projectId>', ...],   // status-flipped
  errors: [{projectId, step: 'moveFolder'|'clearPrefs'|'audit', error}],
}
```

`ok` stays `true` if at least one project was archived; per-project
errors are surfaced in the response. UI shows a summary toast (`3 of 4
archived. 1 had errors — see details`) and renders the error list inline.

Idempotent on re-run: already-archived projects are skipped (status
check before any work).

### 9.6 Symmetric single-project archive / unarchive

`consoleArchiveProject` and `consoleUnarchiveProject` (in
`61_console_api.js`) are extended to use the same code path:

`consoleArchiveProject(projectId)`:
1. `flipProjectStatus_(projectId, 'archived')`
2. `moveProjectToArchived_(project.rootFolderId)`
3. `clearStaleActiveProjectPrefs_(projectId)`
4. `appendAuditEvent_({projectId, action: 'archive', actor, at})`

`consoleUnarchiveProject(projectId)`:
1. `flipProjectStatus_(projectId, 'active')`
2. `restoreProjectFromArchived_(project.rootFolderId)`
3. `appendAuditEvent_({projectId, action: 'unarchive', actor, at})`

Unarchive does NOT restore previously-cleared `activeProjectId` prefs;
students re-select when they next open the extension.

### 9.7 Lifecycle helpers (new in `65_lifecycle.js`)

```js
function moveProjectToArchived_(rootFolderId)
function restoreProjectFromArchived_(rootFolderId)
function clearStaleActiveProjectPrefs_(projectId)
function flipProjectStatus_(projectId, newStatus)   // refactor of the in-place setValue from 12_projects.js
```

`moveProjectToArchived_`: find-or-create the `Archived` folder under
`CONFIG.ROOT_FOLDER_ID` (uses the existing `NAMES.ARCHIVED_FOLDER`
constant — finally), then move the project folder via
`archivedFolder.addFolder(projectFolder); rootFolder.removeFolder(projectFolder);`.

`restoreProjectFromArchived_`: inverse — move back to root.

`clearStaleActiveProjectPrefs_`: user prefs live in
`PropertiesService.getScriptProperties()` under the key shape
`prefs:<actorEmail>:activeProjectId` (per `04_user_prefs.js`). The helper
calls `getProperties()` once, iterates the entries, and for each key
ending in `:activeProjectId` whose value equals the archived `projectId`,
calls `deleteProperty(key)`. Single bulk read + targeted deletes; no
per-user scan.

## 10. Audit log

### 10.1 Storage

Lives as a new tab `Audit` on the **Projects registry workbook** (not
the Roster workbook — events are about projects, not people).

```js
HEADERS.AUDIT = ['eventId', 'projectId', 'action', 'actor', 'at', 'detail'];

const AUDIT_ACTIONS = {
  ARCHIVE: 'archive',
  UNARCHIVE: 'unarchive',
  ARCHIVE_YEAR: 'archive_year',
};
```

`eventId` is a UUID generated server-side. `projectId` is the FK to
`Projects.projectId`. `at` is ISO 8601.

### 10.2 Helpers (in `64_audit.js`)

```js
function ensureAuditTab_()
// Idempotent: creates the Audit tab + headers if absent. Called lazily
// by appendAuditEvent_ and latestUnarchiveFor_. Matches the
// find-or-create pattern used elsewhere in the codebase.

function appendAuditEvent_({projectId, action, actor, detail})
// Stamps eventId + at, appends one row to the Audit tab.

function latestUnarchiveFor_(projectId)
// Reads the Audit tab (full scan; expected <500 rows/year), filters to
// rows where projectId matches AND action === 'unarchive', returns the
// row with the latest `at`, or null.
```

Performance: at <500 rows/year the full scan is microseconds; no index
needed.

### 10.3 Banner data

`consoleGetProjectDashboard` (in `61_console_api.js`) calls
`latestUnarchiveFor_(projectId)`. If the event exists and
`now - event.at < 7 days`, the response includes:

```js
recentUnarchive: {
  eventId,
  actor,
  at,
}
```

Otherwise the field is omitted (not `null` — absent).

### 10.4 Banner UI

Rendered above the all-students table in the Project Dashboard:

```
┌──────────────────────────────────────────────────────────────────────┐
│ ⓘ  This project was unarchived by Paul Ivers on May 27, 2026.    [×] │
│    Students who had it set as active will need to re-select it.      │
└──────────────────────────────────────────────────────────────────────┘
```

`actor` is shown as the staff `Name` if `getStaffEntry_(actor)` returns
a row, else the raw email. The `at` timestamp is rendered as
`"<MMM> <D>, <YYYY>"`.

Dismissal: `localStorage.setItem('dismissedUnarchive:' + eventId, '1')`.
On render, the banner is skipped if its eventId has been dismissed by
the current user. Server-side 7-day expiry means the banner stops
appearing for everyone after a week regardless of dismissal — no
persistent server-side dismissal state.

The banner shows on every teacher's view of the project, not just the
admin who triggered the unarchive — the point is to inform the
classroom teachers who own the affected classes.

## 11. Modifications to existing files (consolidated)

`02_constants.js`:
- `HEADERS.ROSTER` changes from 4 to 7 cols (Section 6).
- `HEADERS.AUDIT` added (Section 10.1).
- `AUDIT_ACTIONS` enum added.

`10_identity.js`:
- New helper `assertAdmin_(actorEmail)` (Section 5).
- `validateRoster` checks updated for the 7-col schema (Section 6).

`11_provisioning.js`:
- `findOrCreateStudentSheet_`'s Meta-row population reads the new
  `First`/`Last`/`Teacher` columns (Section 6).

`12_projects.js`:
- `archiveProject_` → `flipProjectStatus_(projectId, 'archived')`
  refactor; full archive flow moves to `consoleArchiveProject`.
- `unarchiveProject_` → same refactor.

`30_endpoints.js`:
- No changes. The console HTML continues to serve at `doGet` with no
  `?action`; admin views are SPA routes within it.

`61_console_api.js`:
- `listClassesTaughtBy_` joins on `TeacherEmail` (Section 6).
- `consoleArchiveProject` extended per Section 9.6.
- `consoleUnarchiveProject` extended per Section 9.6.
- `consoleGetProjectDashboard` returns `recentUnarchive` when applicable
  (Section 10.3).

`99_dev.js`:
- + 5 `devTest*` functions (Section 12.1).

`console.html`:
- + `<?!= includeFile_('admin_js') ?>` after the existing console_js
  include.

`console_js.html`:
- `buildHeader_` renders the `Admin ▾` dropdown when
  `state.ctx.role === 'admin'`.
- `parseHash_` parses `#/admin/...` routes; `applyHash_` recognizes
  them.
- `renderView_` switch gains `ADMIN_ROSTER`, `ADMIN_STAFF`,
  `ADMIN_LIFECYCLE` cases that delegate to render functions in
  `admin_js.html`.
- `renderDashboard_` checks `data.recentUnarchive` and renders the
  banner above the students table when present + not dismissed.

`console_css.html`:
- + admin table styles (zebra rows, click-to-edit affordance, spinner).
- + typed-confirm modal styles.
- + unarchive banner styles (OPS amber tone).
- + import dialog styles (toggle, textarea, diff preview).

## 12. Testing

### 12.1 Editor-callable dev tests

Five new `devTest*` functions in `99_dev.js`, under a
`// ==== Sub-project C: admin area + lifecycle ====` block. None run
automatically; Paul runs from the GAS editor when verifying.

- **`devTestAdminAuthGate`** — seeds the actor as non-admin staff
  (`teacher` role); calls each `admin*` endpoint; asserts every one
  throws `'Admin only'`. Re-seeds as `admin`; asserts each returns
  `{ok: true}`. ~8 checks.
- **`devTestAdminRosterCrud`** — calls `adminGetRoster`; calls
  `adminAddRosterRow(row)`; asserts the row appears in a re-fetch;
  calls `adminUpdateRosterRow(email, {First: 'NewFirst'})`; asserts
  the update; calls `adminDeleteRosterRow(email)`; asserts removed.
  Cleans up. ~10 checks.
- **`devTestAdminRosterReplace`** — calls `adminPreviewReplaceRoster`
  with 5 hand-crafted rows; asserts the diff shape. Calls
  `adminReplaceRoster`; asserts roster count matches, that pre-existing
  rows not in the new set were removed, that the schema is intact.
  Restores the original roster as cleanup. ~6 checks.
- **`devTestAdminEmailChange`** — seeds a row + a per-student Sheet
  with 3 sources and 5 highlights all stamped with the old email + a
  user_prefs entry. Calls `adminChangeStudentEmail`. Asserts: roster
  row's Email updated; Sheet file renamed; all `createdByEmail` cells
  in Sources+Highlights+Meta now show the new email; user_prefs entry
  rekeyed. Cleans up. ~8 checks.
- **`devTestArchiveSchoolYear`** — seeds 3 dev projects all with
  `schoolYear='dev-yy'` and 1 with another year. Calls
  `adminArchiveSchoolYear('dev-yy', 'ARCHIVE dev-yy')`. Asserts: 3
  projects flipped, 1 untouched, 3 folders moved to `Archived/`, 3
  audit events written. Calls unarchive on one; asserts folder
  restored + audit event written. Cleans up by un-archiving all and
  deleting the seeded projects. ~10 checks.

### 12.2 Manual QA checklist (lives in the implementation plan)

- Sign in as a teacher (non-admin) → no `Admin ▾` link in header.
- Sign in as an admin → `Admin ▾` link appears; dropdown lists Roster,
  Staff, Archive School Year.
- Roster screen: load → table renders with all 7 columns; filter by
  class works; search by name works; click name cell → edit → save.
- Edit email of a row that has work → typed-confirm modal lists per-
  student Sheet + cell counts; typing wrong phrase keeps button
  disabled; typing exact phrase enables.
- Add a new student → appears in table; per-student Sheet auto-
  provisions on first save.
- Bulk import: paste TSV from a copied Sheets range → preview shows
  correct diff → confirm → swap.
- Bulk import: toggle to column-by-column mode → 7-step wizard;
  mismatched row counts blocks Next with an error.
- Staff screen: try to demote the only admin → server rejects, toast
  shows "Cannot remove the only admin".
- Archive School Year: pick a year with 0 projects → confirm button
  disabled with explanation.
- Archive School Year: pick a year with N projects → list shows them;
  confirm phrase enforces exact match including the year.
- After archive: open the project's URL hash directly → dashboard
  loads (read-only stays accessible per build plan).
- Unarchive a project → Drive folder restored from `Archived/`;
  banner appears on dashboard for the next 7 days; dismissable;
  dismissal sticky in localStorage on that browser only.
- Open the Console as a non-staff user → "Not authorized" panel; from
  devtools paste `google.script.run.adminGetRoster()` → server throws.

### 12.3 Performance check

- Roster screen load on a 200-row roster + ~10 projects: <2s (1s for
  the `hasWork` precomputation + 1s for the row read).
- Archive School Year on 5 projects: <8s (status flips ~100ms each;
  folder moves are the bulk).
- Unarchive banner check on dashboard load: <50ms (Audit tab full
  scan on <500 rows).

## 13. Out of scope (deferred sub-projects)

Per Phase 4 decomposition (locked in §15 of the A+B spec):

- **Sub-project D — Group management.** Create/merge/un-merge group
  Sheets, data migration. Build plan §6 risk #10.
- **Sub-project E — Bundle authoring.** UI to define new bundles.

Each will get its own spec. The admin nav built in this spec hosts a
future entry point for either (e.g., `#/admin/groups`, `#/admin/bundles`).

## 14. Out-of-scope reminders (project-wide, per CLAUDE.md §10)

- v1 MLA only.
- 4 source types.
- No "insert as quote" button.
- Bundles immutable.
- Dashboard counts primary category only.

This spec does not touch any of those areas.
