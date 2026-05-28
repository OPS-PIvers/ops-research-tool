# Group Management (Phase 4 — Sub-project D)

**Date:** 2026-05-27
**Status:** Approved design — ready for implementation plan
**Scope:** Phase 4 sub-project D per `docs/build-plan.md` §5 and §“Groups”,
following sub-projects A+B (`2026-05-27-teacher-console-design.md`) and C
(`2026-05-27-admin-area-lifecycle-design.md`). Adds teacher-driven group
formation to the Teacher Console: merge 2–4 in-class students into a
single group Sheet that migrates their existing work, supports move /
disband / un-merge, and renders as visually-grouped rows on the Project
Dashboard.

## 1. Problem

The build plan (§“Groups”) requires that any student can be merged into
a group of 2–4 with full work migration, that groups be un-mergeable and
movable, and that every highlight retain its true author email for
grading fairness. Today’s implementation has only the SOLO path:
`findOrCreateStudentSheet_` always finds-or-creates a Sheet named
`<email>` in the student’s class folder. There is no group Sheet, no
merge UI, no migration routine, and no group-aware dashboard.

The `META` tab already carries a `groupId` column reserved for this
purpose, and the comment in `11_provisioning.js` flags group routing as
the “Phase 4 add-on” — so the data shape is ready; the behavior isn’t.

This spec covers the missing surfaces: a group lifecycle (merge, move,
disband, un-merge), the group Sheet file format, the routing change in
provisioning + reads, the `Manage groups` mode on the Project Dashboard,
and the visual grouping in the dashboard table.

## 2. Goals

- A teacher can merge 2–4 students from a single class into a group in
  under 60 seconds, without leaving the Project Dashboard. All of those
  students’ existing sources + highlights migrate into the group Sheet.
- A teacher can move a student from one group to another, disband a
  group back to solos, or un-merge a single student — without data loss
  and without merge-induced source duplicates getting silently injected.
- The Project Dashboard distinguishes solos from groups at a glance:
  group members render under a collapsible group-header row with an
  aggregate stack-bar, while still being individually drill-downable for
  grading.
- Every highlight retains `createdByEmail` through merge and un-merge —
  no exception, no overwrite, ever.
- The Chrome extension’s project picker keeps working with zero changes:
  when a student is in a group, their writes silently route to the
  group Sheet via the existing provisioning hook.
- Lifecycle events (merge, move, disband, un-merge) write audit rows
  through the existing `appendAuditEvent_` so admins can reconstruct
  what happened from the Audit tab.

## 3. Non-goals

- **Cross-class groups.** A group’s members must all share the same
  `Class` string in the roster. This is absolute; admins do not get an
  override toggle. Exceptions corrupt the per-teacher dashboard scope
  rules established in sub-project A+B (`listClassesTaughtBy_`).
- **Auto-dedupe of sources on merge.** Per build plan §“Groups”: if
  Alice and Bob both highlighted `nytimes.com/foo` before merging, the
  group Sheet ends up with both source rows. Manual cleanup in the
  sidebar. Auto-merge requires deciding whose annotation/classification
  wins — a rabbit hole; keep merge dumb and reliable.
- **Group-aware bibliographies in the sidebar.** Bibliography insertion
  reads the active project’s sources for the *actor*; when the actor is
  in a group, that’s automatically the group Sheet. No client change.
- **Bundle authoring.** Sub-project E.
- **Real-time presence indicator** (“Alice is highlighting now”). 3–5
  concurrent students on one Sheet is rare and Apps Script’s append
  contention absorbs it; surfacing presence is not worth the complexity.
- **A separate “groups” route or screen.** Group management is a *mode*
  on the existing Project Dashboard, not a new SPA view.
- **Group-by-source-type or any other auto-grouping heuristics.** Groups
  are formed deliberately by a teacher, never inferred.
- **Per-source attribution rewrite.** A highlight always shows its
  original `createdByEmail`. Sources keep the email of whoever first
  saved the URL — not rewritten on merge.

## 4. Architecture

Single GAS web app deployment, same Script project as the existing
extension/sidebar/console code. Group surfaces are additive: one new
server module (`66_groups.js`), one set of `consoleGroup*` endpoints
appended to `61_console_api.js`, modifications to `11_provisioning.js`
and `21_reads.js` to honor group routing, and dashboard-side rendering
changes in `console_js.html` / `console_css.html`.

The group Sheet is structurally identical to a per-student Sheet
(`Meta`, `Sources`, `Highlights` tabs with the same `HEADERS.*`) plus
one new tab: `Members`. This makes every existing read path
(`readSourcesForActor_`, `readHighlightsForActor_`,
`sidebarGetProjectData`, the dashboard aggregator) keep working with no
changes — they already key off `createdByEmail` for filtering when
needed and treat the Sheet as the unit of storage.

The routing change lives in one place: `findOrCreateStudentSheet_`
gains a “if (project, student) ∈ a group, return the group Sheet
instead” branch at the top. Every downstream caller is unaware of the
distinction.

```
[Project Root Folder]
├── [Class A folder]
│   ├── alice@orono.k12.mn.us       (solo)
│   ├── [grp] Pacific Theater       (Alice + Bob + Carol; in-class only)
│   └── dave@orono.k12.mn.us        (solo)
├── [Class A folder] / Archived-students /
│   ├── alice@orono.k12.mn.us       (moved here when she joined the group)
│   ├── bob@orono.k12.mn.us
│   └── carol@orono.k12.mn.us
└── [Class B folder]
    └── eve@orono.k12.mn.us
```

## 5. Authorization

### Client gate

The “Manage groups” toggle is rendered only when `state.ctx.staff` is
truthy AND the current dashboard’s scoped classes are non-empty. The
mode is available to any staff viewing the dashboard — there is no
admin-only group action. A teacher who teaches 7A can manage groups
within 7A; an admin who sees all classes can manage groups within each
class independently.

### Server gate

Every `consoleGroup*` endpoint calls `assertStaff_(actorEmail)` first,
identical to today’s `consoleArchiveProject` pattern. The in-class
constraint is enforced server-side too: `consoleGroupCreate` rejects
member lists where the resolved roster rows have differing `Class`
values, with the error message `"All group members must share the same class"`. Defense in depth — the client filters the picker, the server
re-checks.

The teacher scope check from sub-project A+B (`listClassesTaughtBy_`)
applies: a 7A teacher attempting a `consoleGroupCreate` on a 7B group
is rejected with `'Class not in your scope'`. Admins skip this check.

## 6. Group Sheet — file format

### 6.1 Naming and location

- File name: `[grp] <name>` where `<name>` is the teacher-supplied
  group name (default placeholder: `Group N` where N is the next
  unused integer in this class for this project — see §6.4).
- Drive location: under the project’s class folder, alongside
  per-student Sheets. The `[grp] ` prefix makes the file visually
  distinct from email-named Sheets when an admin browses Drive.
- Rename is cheap and supported: changing the friendly name updates the
  Drive file name in place; nothing else depends on the file name as a
  key.

### 6.2 Tab layout

Identical to per-student Sheets, with one addition:

```
[grp] Pacific Theater
├── Meta         (one row per group, shape below)
├── Members      (NEW — one row per member email; full join/leave history)
├── Sources
└── Highlights
```

The `Meta` row reuses `HEADERS.META` with one column repurposed:

|Column        |Solo Sheet                  |Group Sheet                                                  |
|--------------|----------------------------|-------------------------------------------------------------|
|`studentName` |“Last, First”               |Group name (e.g., `Pacific Theater`)                         |
|`studentEmail`|actor’s email               |empty (`""`) — Members tab is the source of truth            |
|`class`       |actor’s class               |the (single) class string shared by all members              |
|`teacher`     |actor’s teacher display name|empty — would be misleading; class membership implies teacher|
|`projectId`   |actor’s projectId           |same projectId                                               |
|`groupId`     |empty                       |the group’s own ID                                           |

`groupId` is a UUID minted at merge time and stored as the canonical
identifier across all surfaces. The Sheet’s Drive file ID is used for
file operations; `groupId` is used for everything else (audit log,
dashboard rendering, extension routing, Members tab joins).

### 6.3 Members tab

New tab on every group Sheet. Header: `HEADERS.GROUP_MEMBERS`.

```js
HEADERS.GROUP_MEMBERS = [
  'email',         // lowercased; matches roster Email
  'firstName',     // snapshotted from roster at join time
  'lastName',      // snapshotted from roster at join time
  'joinedAt',      // ISO timestamp
  'leftAt',        // ISO timestamp or empty — empty means current member
];
```

A member is “current” if their row’s `leftAt` is empty. History rows
(non-empty `leftAt`) are kept indefinitely — they document the group’s
composition over time, and they’re what un-merge / disband flows
inspect to find the right archived per-student Sheets to restore.

Snapshotting `firstName` / `lastName` at join time matters because
admins can rename roster rows mid-project. The Members tab should
record who the group was, not who the roster says they are today.

### 6.4 Group numbering

`Group N` placeholder names are scoped to (project, class): the first
group made in (NHD 2026, 7A) is `Group 1`, the second is `Group 2`,
etc. Computed at merge-dialog open time by counting current groups in
the (project, class) tuple and adding 1. The teacher overrides freely;
nothing depends on `Group N` being unique or stable after the merge.

## 7. Group lifecycle

Four operations, all server-side; all idempotent under retry; all log
to the Audit tab.

### 7.1 Merge

`consoleGroupCreate(projectId, name, memberEmails)` — Creates a new
group containing the listed members and migrates their existing work.

**Preconditions:**

- 2–4 members.
- All members on the roster, all share the same `Class`, all in a class
  listed in `project.memberClasses`.
- None of the members are currently in another group in this project
  (server checks Meta.groupId on each per-student Sheet; if any is
  non-empty, throw `"<email> is already in a group — move them out first"`).
- `name` non-empty after trim; ≤ 60 chars.

**Atomic order (crash-recovery aware):**

1. **Mint and stage.** Generate a fresh `groupId` UUID. Create the
   group Sheet (`[grp] <name>`) in the appropriate class folder.
   Initialize `Meta`, `Members`, `Sources`, `Highlights` tabs with
   headers. Populate `Meta` row. Populate `Members` tab with one row
   per member (`leftAt` empty).
1. **Copy rows.** For each member, open their per-student Sheet, read
   all `Sources` and `Highlights` rows, append them to the group
   Sheet’s corresponding tabs. Rows are inserted as-is — `sourceId`,
   `highlightId`, `createdByEmail`, `createdAt`, `projectId` all
   preserved. No transformation. (`projectId` is already the same;
   this is asserted defensively.)
1. **Flip pointers.** For each member’s per-student Sheet, set
   `Meta.groupId` to the new `groupId`. Members lookups happen
   server-side via Members tab scan, but flipping `Meta.groupId` on
   the per-student Sheet provides a fast “is this student in a group
   for this project?” check from the provisioning hook without opening
   the group Sheet.
1. **Move sheets.** Move each member’s per-student Sheet from
   `Class A/` to `Class A/Archived-students/`. Create the
   `Archived-students` folder lazily.
1. **Audit.** Append one row per member to the Audit tab:
   `action='group_merge'`, `detail='groupId=<uuid>;memberEmail=<email>'`.

**Crash recovery:** Each step is idempotent. A cleanup endpoint
`consoleGroupCheckIntegrity(projectId)` (admin-only, no client UI in
this sub-project — exposed for manual recovery via GAS editor) walks
the project and reports any drift: a group whose Sheet exists but
whose members still have unarchived per-student Sheets, a member
whose `Meta.groupId` points to a non-existent group, etc.

### 7.2 Move

`consoleGroupMoveStudent(projectId, email, fromGroupId, toGroupId)` —
Move a student from one group to another within the same project. Both
groups must be in the same class.

**Atomic order:**

1. Open `fromGroupId`‘s Members tab; set the student’s `leftAt`.
1. Read all `Sources` + `Highlights` rows in the `from` group where
   `createdByEmail` matches the student’s email. **Do not delete them
   from `from`** — they remain attributed to the student and stay part
   of the original group’s body of work.
1. **Do not copy them to `to`** either. The student joins the new
   group fresh; if they want to share research already done in the old
   group, the new group’s members can manually copy/cite. This keeps
   move surgical and avoids creating duplicate source records that the
   “no auto-dedupe” rule would otherwise leave behind.
1. Append a Members row in `toGroupId` with the student’s snapshot.
1. Audit: `action='group_move'`,
   `detail='from=<fromId>;to=<toId>;email=<email>'`.

**Implication for the teacher:** “Move” is documented in the UI as
“adds <email> to <to>‘s membership without copying prior work.” If the
teacher actually wants the student’s research moved over too, they
disband and re-merge (rare, but supported).

### 7.3 Disband

`consoleGroupDisband(projectId, groupId)` — Dissolves a group back to
solos. Each current member’s per-student Sheet is restored from
`Archived-students/` as-is (the pre-merge snapshot); the group Sheet is
moved to `Archived-students/` for posterity.

**Atomic order:**

1. Read the Members tab; identify all current members.
1. For each current member:
- Locate their archived per-student Sheet in `Archived-students/`.
- Move it back to the class folder root.
- Set `Meta.groupId` back to empty on the restored Sheet.
- Mark `leftAt` on their row in the group’s Members tab.
1. Move the group Sheet itself into `Archived-students/`. (We keep
   the group Sheet around in case it needs to be revived; the
   `[grp] ` prefix makes it findable.)
1. Audit: one `action='group_disband'` row per member +
   one `action='group_disband_group'` row for the group itself.

**Documented limitation:** any work the group produced *while merged*
stays in the (now-archived) group Sheet. It does not migrate back to
the solo Sheets. If a student wants to keep researching a URL the
group started on, they re-add it as a solo source. This is the
explicit honest-about-the-model choice from §3 of this spec.

### 7.4 Un-merge a single student

`consoleGroupRemoveStudent(projectId, groupId, email)` — Removes one
student from a group of >2 without disbanding the group. Same as a
disband, but for one member.

**Atomic order:**

1. Verify the group will still have ≥ 2 members after removal (else
   reject — `"Group must have ≥ 2 members. Use disband instead."`).
1. Restore that member’s per-student Sheet from `Archived-students/`
   to the class folder root. Set `Meta.groupId` empty.
1. Mark `leftAt` on their Members row.
1. Audit: `action='group_unmerge'`,
   `detail='groupId=<id>;email=<email>'`.

Same documented limitation as §7.3: group-period work stays in the
group Sheet.

### 7.5 Audit actions added

Append to `AUDIT_ACTIONS` enum in `02_constants.js`:

```js
AUDIT_ACTIONS = {
  // ...existing
  GROUP_MERGE: 'group_merge',
  GROUP_MOVE: 'group_move',
  GROUP_DISBAND: 'group_disband',
  GROUP_DISBAND_GROUP: 'group_disband_group',
  GROUP_UNMERGE: 'group_unmerge',
};
```

## 8. Reads

### 8.1 Provisioning routing

`findOrCreateStudentSheet_` in `11_provisioning.js` gains a top-level
group check:

```js
function findOrCreateStudentSheet_(actorEmail, project) {
  // NEW: group routing
  const groupSheet = findGroupSheetForStudent_(actorEmail, project);
  if (groupSheet) return groupSheet;
  // ...existing solo path below
}
```

`findGroupSheetForStudent_` lives in the new `66_groups.js`:

1. Resolve the actor’s class via roster.
1. Walk the project’s class folder for files starting with `[grp] `.
1. For each candidate, open it, read the Members tab, check whether
   `email` matches an `email` row with empty `leftAt`.
1. Return the first match’s Spreadsheet object, or `null`.

This is O(groups × open) — a few hundred ms typically. To avoid this
cost on every doPost, the result is cached for the duration of the
request in a script-scoped object: `_groupSheetCache[<email,projectId>]`.

### 8.2 Existing read paths

`readSourcesForActor_` and `readHighlightsForActor_` in `21_reads.js`
already call `findOrCreateStudentSheet_` internally. With the
provisioning change, they automatically read from the group Sheet for
group members. No code change needed in those functions.

`sidebarGetProjectData` likewise auto-routes via the same hook.

### 8.3 Dashboard aggregation

`consoleGetProjectDashboard` in `61_console_api.js` walks each student
in the teacher’s scoped classes and reads their data. With group
routing, multiple students will resolve to the same group Sheet. To
avoid opening the same Sheet N times for an N-person group, we add a
Sheet-id-keyed memo per request:

```js
const sheetCache = {};  // sheetId → {sources, highlights}
```

For each roster student, resolve their Sheet (group or solo), use
`sheetCache` if already present. Each group Sheet’s rows are read once
per dashboard load.

For the per-student `aggregateStudent_` call, filter the group’s
`sources` and `highlights` to rows where `createdByEmail === student.email`
before computing aggregates. **This is the grading-fairness invariant
made concrete:** the dashboard’s per-student stack-bar shows only what
that student personally authored, even inside a group.

For the group-header aggregate (§9.2 of this spec), the unfiltered
rows are used — that’s the full group’s body of work.

## 9. Project Dashboard — Manage Groups mode + grouped rendering

### 9.1 Manage Groups toggle

A `[ Manage groups ]` toggle button is added to the dashboard toolbar
(right side, next to `[↻ Refresh]`). Three states:

- **Off (default).** Dashboard renders as today: flat or visually-
  grouped per-student rows; row click → drill-down.
- **On.** Header bar at the top shows the action area; each row gets a
  leading checkbox; row-body click no longer navigates to drill-down
  (only the action area buttons act).
- Toggle off → return to default.

The toggle’s enabled state lives in `state.manageGroups` (boolean).

### 9.2 Visual grouping (always, regardless of mode)

In both modes, the dashboard is sorted so group members appear under a
synthetic group-header row, with all solos appearing as siblings.
Layout:

```
┌────────────────────────────────────────────────────────────────────┐
│ ▼ [grp] Pacific Theater  · 3 members             ████░░░░  68%  3h │
│   └ Alice Chen           7A  · 12 highlights     ███░░░░░  62%  3h │
│   └ Bob Smith            7A  · 8 highlights      ██░░░░░░  50%  4h │
│   └ Carol Diaz           7A  · 15 highlights     ████░░░░  79%  2d │
│ Dave Jones (solo)        7A  · 6 highlights      ██░░░░░░  40%  1d │
│ Eve Park (solo)          7A  · 22 highlights     █████░░░  85%  1h │
└────────────────────────────────────────────────────────────────────┘
```

- The group-header row’s cells:
  - Name column: `▼ [grp] <name> · N members` (chevron is the
    collapse toggle).
  - Category stack-bar: aggregated across all members (sum of
    counts per category in bundle order).
  - Completion bar: aggregate (`sum complete / sum total` across
    members; same green/amber/red bands as the per-student row).
  - Gap chips: aggregate counts (sum of each gap type across
    members).
  - Last activity: max across members.
- Clicking the group-header row (when mode is Off):
  - On chevron: toggles collapse — saves to `state.collapsedGroups`
    Set in the client; survives within the session.
  - On the body: navigates to a group-aggregate drill-down at hash
    `#/projects/<id>/groups/<groupId>`. Same 4 chart blocks as the
    student drill-down, computed from the group Sheet’s full
    (unfiltered) rows.
- Clicking a child-student row (when mode is Off): same as today —
  navigates to per-student drill-down at hash
  `#/projects/<id>/students/<email>`. The student’s drill-down still
  uses the `createdByEmail`-filtered slice (§8.3), so it shows their
  personal contribution.

Solos display flat — no group header, same as today.

### 9.3 Group-aggregate drill-down

`consoleGetGroupDashboard(projectId, groupId)` — Same shape as
`consoleGetProjectDashboard` for a single student, but the inputs are
the group’s full unfiltered Sources + Highlights and the output
contains:

- `group: { groupId, name, memberEmails, memberCount }`
- 4 aggregate blocks (matching the student drill-down’s 4 blocks).
- Sources & highlights viewer renders all sources with all highlights;
  each highlight badge shows the original `createdByEmail` for
  attribution.

This is also the only place attribution is rendered to the teacher
visually. The per-student drill-down already implicitly attributes
(it’s filtered to that student); the group drill-down needs the
explicit byline because multiple authors are mixed.

### 9.4 Manage Groups action area (when toggle is On)

A sticky action bar appears between the toolbar and the table:

```
┌────────────────────────────────────────────────────────────────────┐
│ Manage groups mode — click rows to select.  [N] selected.  [Exit]  │
│  [+ Merge into group (N)]   [Move to ▾]   [Disband group]          │
└────────────────────────────────────────────────────────────────────┘
```

Button enablement:

- **Merge into group (N):** enabled when 2 ≤ N ≤ 4 and all selected
  rows are *solo* students of the *same class*. Click → opens a merge
  modal (name field with `Group N` placeholder; preview of which
  students are being merged). Confirm → calls `consoleGroupCreate`.
- **Move to ▾:** enabled when N == 1 and the selected row is a
  *student* (solo or grouped). Dropdown lists every group in that
  student’s class for this project. Selecting a target group calls
  `consoleGroupMoveStudent` (and on solo-to-group move, the migration
  semantics from §7.2 apply — no work copied).
- **Disband group:** enabled when N == 1 and the selected row is a
  *group header*. Confirms first (“Disband <name>? Members become
  solo. Work created during the group stays in the group Sheet.”).
  Then calls `consoleGroupDisband`.
- **Remove from group:** appears as a kebab item on each grouped-
  student row in Manage mode. Calls `consoleGroupRemoveStudent`.
  Hidden when the group has only 2 members (rejected at server too).

After any action returns success: the dashboard refreshes (existing
`refresh()` path) and the toggle stays on.

### 9.5 Empty states

- No groups, mode Off: dashboard renders flat per-student rows
  (matches today’s view exactly).
- No groups, mode On: action area visible, table renders normally;
  no Move dropdown content (it’s disabled).
- All students in groups: only group headers + grouped rows render.
- Class has no students: dashboard renders the existing “no students”
  empty state regardless of mode.

## 10. Extension picker — no UI changes

The extension’s project picker remains unchanged. A student in a group
sees their projects exactly as before. When they highlight, the writes
flow through the existing `doPost` path, which calls
`findOrCreateStudentSheet_`, which now returns the group Sheet via the
new routing branch (§8.1).

The student does **not** see anywhere in the extension that they’re
“in a group” — this is a deliberate choice. NHD groups are a
classroom-management abstraction; the student’s job is to keep
highlighting. If the teacher disbands or moves them mid-project, the
extension will (transparently) start writing to a different Sheet on
the next highlight. They’ll never notice.

Stored active project (`activeProjectId` in `chrome.storage.local`)
needs no rebinding. The roster doesn’t tell the extension which Sheet
to write to — the server does.

### 10.1 Sidebar — no UI changes

The Docs sidebar reads via `sidebarGetProjectData`, which routes the
same way. A grouped student opens the sidebar and sees the group’s
sources/highlights as if they were their own. They can edit citations,
update annotations, delete highlights, and insert bibliographies just
like a solo student would. **Edits to citations and source-level
metadata are shared** across the group — that’s the point of merging.

Deletes of highlights they didn’t author are *allowed* by the current
write path (the sidebar doesn’t enforce `createdByEmail` on deletes).
Whether to gate that is out of scope here; document it as a follow-up
in CLAUDE.md so a future sub-project (perhaps observability) can pick
it up.

## 11. Modifications to existing files (consolidated)

`02_constants.js`:

- New tab name `GROUP_MEMBERS` in `TABS`.
- New `HEADERS.GROUP_MEMBERS` (Section 6.3).
- New `NAMES.ARCHIVED_STUDENTS_FOLDER = 'Archived-students'`.
- New `NAMES.GROUP_SHEET_PREFIX = '[grp] '`.
- New audit actions added to `AUDIT_ACTIONS` (Section 7.5).

`11_provisioning.js`:

- `findOrCreateStudentSheet_` calls new `findGroupSheetForStudent_`
  at the top; falls through to existing solo path on no match.

`21_reads.js`:

- No changes — existing functions auto-route via provisioning hook.

`30_endpoints.js`:

- No changes.

`53_sidebar_api.js`:

- No changes.

`61_console_api.js`:

- `consoleGetProjectDashboard`: add Sheet-id memo (Section 8.3);
  filter group rows by `createdByEmail` for per-student aggregates;
  emit synthetic group-header rows in the response shape (§9.2).
- New endpoints (appended): `consoleGroupCreate`, `consoleGroupMove`,
  `consoleGroupDisband`, `consoleGroupRemoveStudent`,
  `consoleGetGroupDashboard`, `consoleGroupCheckIntegrity`
  (admin-only, recovery).

`66_groups.js` (NEW):

- `findGroupSheetForStudent_(email, project)` → Spreadsheet|null.
- `createGroupSheet_(project, classFolderId, name, memberEmails)` →
  group object.
- `copyMemberRowsIntoGroup_(groupSheet, studentSheet)` — bulk copy
  Sources + Highlights.
- `archiveStudentSheetForGroup_(studentSheet, classFolder)`.
- `restoreStudentSheetFromArchive_(email, project)`.
- `listGroupsForProject_(project, classFilter?)`.
- `getGroupById_(project, groupId)`.
- Server-side validators (one class, 2–4 members, etc.).

`console.html`:

- No structural change; the new view ID `GROUP` is handled in JS only.

`console_js.html`:

- `parseHash_` recognizes `#/projects/<id>/groups/<groupId>` →
  `view: 'GROUP'`.
- `renderView_` switch adds `GROUP` case → `renderGroupDetail_`.
- `renderDashboard_` builds grouped rows (Section 9.2) — synthesizes
  header rows from the dashboard response, sorts solos + group blocks.
- `state.manageGroups` boolean; `state.collapsedGroups` Set.
- New `renderManageGroupsBar_` and merge/move/disband modal helpers.
- `renderStudentRow_` adds checkbox when in Manage mode; row click
  navigates only when not in Manage mode.

`console_css.html`:

- Group header row styles (indent, chevron, distinct background).
- Action bar styles (sticky position, button states).
- Manage-mode row highlighting.
- Merge modal styles (member preview, name input).

`99_dev.js`:

- New `devTest*` functions for the group lifecycle (Section 12.1).

No changes to: `00_config.js`, `01_setup.js`, `03_utils.js`,
`04_user_prefs.js`, `10_identity.js`, `12_projects.js`,
`13_bundles.js`, `20_writes.js`, `40_seed_history_day.js`,
`50_docs_addon.js`, `51_citation.js`, `52_bibliography.js`,
`60_console_routing.js`, `62_aggregator.js`, `63_admin_api.js`,
`64_audit.js`, `65_lifecycle.js`, `sidebar.html`, `sidebar_js.html`,
`sidebar_css.html`, `source_editor.html`, `source_editor_js.html`,
`admin_js.html`, `extension/**`.

## 12. Testing

### 12.1 Editor-callable dev tests

Five new functions in `99_dev.js`, under a
`// ==== Sub-project D: groups ====` block.

- **`devTestGroupRoutingProvisioning`** — Seeds the Dev Project with 3
  dev students in class `DEV`. Calls `consoleGroupCreate` to merge
  them. Asserts: group Sheet exists with the right name; 3 archived
  Sheets exist in `Archived-students/`; `Meta.groupId` on each
  archived Sheet matches; Members tab has 3 current rows.
  Then writes a highlight via `findOrCreateStudentSheet_(<member>, project)` and asserts it lands in the group Sheet, not a re-created
  per-student Sheet. ~8 checks. Cleans up by disbanding.
- **`devTestGroupMergeMigrationFidelity`** — Seeds 3 dev students,
  each with 2 sources and 4 highlights pre-merge (varying categories).
  Counts before/after merge: 6 sources + 12 highlights total.
  Merges; reads group Sheet; asserts row counts match and that every
  `createdByEmail` value is preserved. ~6 checks. Cleans up.
- **`devTestGroupDisbandRoundTrip`** — Merges 3, disbands, asserts:
  each archived Sheet is restored to class folder root, `Meta.groupId`
  is empty again, group Sheet is moved into `Archived-students/`,
  per-student writes after disband route back to the restored solo
  Sheets. ~7 checks. Cleans up archived-students folder.
- **`devTestGroupMoveSemantics`** — Merges A+B into Group 1, merges
  C+D into Group 2 (same class). Moves D from Group 2 to Group 1.
  Asserts: Group 1 has 3 current members (A, B, D); Group 2 has 1
  current member (C); Group 2’s `consoleGroupRemoveStudent` for C is
  rejected because removal would drop below 2; `consoleGroupDisband`
  works on Group 2 instead. Asserts D’s prior work is in Group 2,
  *not* migrated to Group 1. ~9 checks. Cleans up.
- **`devTestGroupAuthorizationGate`** — Seeds a 2-class scenario
  (DEV and DEV-2). As a non-staff actor, calls each `consoleGroup*`
  endpoint — each must throw. As a teacher whose `TeacherEmail`
  doesn’t cover DEV-2, calls `consoleGroupCreate` with DEV-2 members
  — must throw `'Class not in your scope'`. As same teacher, mixes
  DEV + DEV-2 members in one merge — must throw `'All group members must share the same class'`. ~6 checks.

### 12.2 Manual QA checklist (lives in implementation plan)

- Open dashboard for a project with no groups → renders flat (matches
  today’s view exactly).
- Click `[Manage groups]` → checkboxes appear, drill-down disabled.
- Check 2 solos from class 7A → `Merge into group (2)` enables.
- Check a 3rd from class 7B → button disables; tooltip explains why.
- Uncheck the 7B kid → re-enables.
- Click Merge → modal opens; name field placeholder shows `Group 1`.
- Submit with default name → modal closes; dashboard refreshes;
  `▼ [grp] Group 1` header appears with 2 children.
- Click `▼` chevron → group collapses (header still visible,
  members hidden); click again to expand.
- Click group-header body (mode Off) → group-aggregate drill-down
  loads; 4 charts render; sources viewer shows attribution badges.
- Click a grouped child row (mode Off) → per-student drill-down for
  that one student; aggregates only show their personal authorship.
- Toggle Manage mode on; check the group header → `Disband group`
  enables. Confirm → group dissolves; both members reappear as
  solos. Their pre-merge highlights are present again.
- Check one grouped student → `Move to ▾` enables; pick another
  group → student moves; old group’s body of work stays attributed
  to them via `createdByEmail`.
- Kebab on a grouped row → `Remove from group` visible (if group has
  ≥ 3 members). For a 2-member group: hidden. Server also rejects.
- Open the merged group’s URL hash directly in another browser tab
  → group-aggregate drill-down loads cold.
- Switch to extension as one of the merged students → highlight a
  new passage on a page → reload dashboard → new highlight appears
  in the group’s mix, attributed to the student.
- Sidebar of a grouped student → shows group’s sources + highlights;
  edit a citation → next dashboard refresh reflects the change.
- Open browser dev tools as a teacher; paste
  `google.script.run.consoleGroupCreate('<id>', 'X', ['kid@notinclass'])`
  → server throws.

### 12.3 Performance check

- Dashboard load (25 students, 5 groups of ~3): < 8 s (vs. today’s
  < 6 s for 25 solos). Extra cost is the per-group-Sheet open; the
  Sheet-id memo prevents repeats.
- Merge of 3 members each with 5 sources + 20 highlights: < 12 s
  (Drive moves dominate). Acceptable for a deliberate teacher action.
- Disband of same: < 10 s.

If these regress past the targets in pilot, consider caching the
dashboard response (admin-area-lifecycle spec mentioned the same
caching idea — would benefit both).

## 13. Open follow-ups (out of scope, documented)

- **Highlight-delete by non-author.** §10.1 notes the sidebar allows
  any group member to delete any highlight. Likely fine for v1; flag
  in CLAUDE.md so observability sub-project (or v1.1 polish) can pick
  up.
- **Audit log UI.** `consoleGroupCheckIntegrity` exists server-side
  with no client surface. If pilot reveals it’s needed often, add it
  to the admin nav.
- **Group renaming.** Not in this spec. Could be a kebab item on the
  group header in Manage mode — trivial to add later, no schema
  changes needed.

## 14. Out-of-scope reminders (project-wide, per CLAUDE.md §10)

- v1 MLA only.
- 4 source types.
- No “insert as quote” button.
- Bundles immutable.
- Dashboard counts primary category only.

This spec does not touch any of those areas.
