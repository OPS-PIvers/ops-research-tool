# Teacher Console — Foundation + My Projects + Project Dashboard

**Date:** 2026-05-27
**Status:** Approved design — ready for implementation plan
**Scope:** Phase 4 sub-project A+B per `docs/build-plan.md` §5. Three-screen
Teacher Console: My Projects, Project Dashboard, Student Drill-down. Plus
the web-app shell, OPS branding, and Staff-list-gated auth.

## 1. Problem

Teachers have no way to monitor student progress on research projects. The
extension and sidebar serve the student-side workflow (capture, annotate,
write); the teacher's side is unbuilt. Build plan §5 Phase 4 specifies a
GAS web app with project management and a per-project visual dashboard.

This spec covers the first usable slice: foundation + My Projects (create
/ open / archive) + Project Dashboard (visual all-students table) + Student
Drill-down (charts, completion, sources & highlights viewer).

## 2. Goals

- Teachers see, at a glance, which students need follow-up (gaps, low
  activity, missing classifications) without reading numbers — visual
  heat-map scanning.
- Teachers can spin up a new research project in under 60 seconds without
  leaving the console (no Sheet manipulation, no folder picking).
- Per-student drill-down answers "what is this student actually doing?"
  with the bar chart that's the build-plan §"Project Dashboard"'s star.
- Staff-list-gated; non-staff users see "Not authorized" — never see any
  student data.
- OPS-branded. The Console is a district-facing tool and looks like one.
- Pilot-ready: a teacher with 25 students can use it end-to-end.

## 3. Non-goals

- **Admin area** (roster management, bulk "Archive school year"). Separate
  sub-project C in Phase 4.
- **Group management** (create/merge/unmerge group Sheets). Sub-project D.
- **Bundle authoring.** v1 ships with one bundle (History Day); wizard
  reads `listBundles_()`. Authoring UI is sub-project E.
- Teacher goal-setting, source credibility scoring, data export — deferred
  past v1 per build plan §"Teacher dashboard".
- Real-time push from student writes. Console uses manual refresh +
  on-focus auto-refresh; no SSE, no background polling.
- Cross-class visibility for teachers. A teacher who teaches 7A opening
  the NHD project (member classes 7A+7B+7C, taught by Smith and Jones)
  sees only 7A students. Admins see all classes.

## 4. Architecture

Single GAS web app deployment, same Script project as the existing
extension/sidebar code. The Web App's `doGet` adds one branch at the top:
no `?action=` → return Console HTML; otherwise fall through to the
existing JSON dispatcher used by the Chrome extension. Same `/exec` URL.

### File layout

```
apps-script/src/
  30_endpoints.js           ← MODIFIED: doGet routes no-action requests to console
  60_console_routing.js     ← NEW: serveConsoleHtml_
  61_console_api.js         ← NEW: console* endpoints called via google.script.run
  62_aggregator.js          ← NEW: pure aggregation functions, editor-testable
  console.html              ← NEW: shell template, includes css + js sub-files
  console_css.html          ← NEW: OPS-branded styles
  console_js.html           ← NEW: vanilla JS — state machine + 3 screens
  99_dev.js                 ← MODIFIED: +5 devTest* functions
```

### State machine

Three views: `MY_PROJECTS` (default), `DASHBOARD`, `STUDENT`. Held in a
single client-side state object: `{ view, projectId, studentEmail }`.
View transitions update the state, update the URL hash, then re-render.

### URL hash routing

- `#/projects` → My Projects (default)
- `#/projects/<projectId>` → Project Dashboard
- `#/projects/<projectId>/students/<email>` → Student Drill-down

Browser back/forward works. Bookmarkable. Teachers can deep-link a student
to a colleague.

### Tech stack

- **Vanilla JS** for the Console (consistent with extension + sidebar).
- **Chart.js 4.x** loaded once via CDN for the drill-down's two charts.
- **GAS HtmlService** to serve the page.
- **`google.script.run`** for client→server calls (no doPost POSTs from
  the Console — teacher actions are reads + a few low-volume writes
  better served by `google.script.run`).

## 5. Authentication & authorization

### Client-side gate (UX)

On Console load, the JS calls `consoleGetContext()` first:

```js
{
  ok: true,
  actor: 'paul.ivers@orono.k12.mn.us',
  staff: { Name, Email, Role },     // null if not on Staff sheet
  role: 'admin' | 'teacher' | null,
  teacherClasses: ['7A', '7B', ...] // empty for admins (use null sentinel)
}
```

If `staff === null`, the JS swaps the entire app DOM with a small
"Not authorized" panel:

> This tool is staff-only. Sign in with your district account, or contact
> your district admin if you believe this is a mistake.

No further calls are made.

### Server-side gate (security)

Every `console*` endpoint re-checks staff status:

```js
function consoleGetMyProjects(filter) {
  const actorEmail = getActorEmail_();
  const staff = getStaffEntry_(actorEmail);
  if (!staff) throw new Error('Not authorized');
  // ... role-aware filtering follows
}
```

A non-staff user crafting a manual `google.script.run.consoleGetMyProjects()`
call gets rejected.

### Role-based filtering (server-side)

- `consoleGetMyProjects` — teacher: `listActiveProjects_()` filtered to
  projects whose `memberClasses` intersect the teacher's `teacherClasses`.
  Admin: all projects.
- `consoleGetProjectDashboard(projectId)` — teacher: reads only student
  sheets whose `Class` ∈ `teacherClasses`. Admin: all classes in the
  project.
- `consoleGetStudentDetail(projectId, email)` — teacher: verify the
  target student's Class ∈ `teacherClasses` before reading anything.
  Admin: no class check.

No UI option to "see other teachers' classes" in this sub-project.

## 6. My Projects screen

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ OPS Research Tool                          Paul Ivers · admin ▾ │
├──────────────────────────────────────────────────────────────────┤
│  My Projects                                  [+ New project]    │
│  ─────────                                                       │
│  ● Active   ○ Archived                                           │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ NHD 2026                                                 │    │
│  │ 2025-26 · History Day · 7A, 7B, 7C  · 58 students        │    │
│  │                                             [Open] [⋯]   │    │
│  └──────────────────────────────────────────────────────────┘    │
│  …                                                               │
└──────────────────────────────────────────────────────────────────┘
```

### Card fields

- **Title:** project name.
- **Subtitle:** `<schoolYear> · <bundleName> · <memberClasses joined "," > · <studentCount> students`.
- **studentCount:** roster entries whose `Class ∈ project.memberClasses ∩ teacherClasses`
  (admins see total of all classes in `memberClasses`). Computed in
  `consoleGetMyProjects` from the Roster sheet — no per-student-sheet
  reads needed at this level.
- **`[Open]` button:** state transition to `DASHBOARD`, URL hash updates,
  fires `consoleGetProjectDashboard`.
- **`[⋯]` kebab menu:** Archive (active list) or Unarchive (archived
  list). See §10.

The project list is intentionally read-light: it only reads the Projects
registry + the Roster. No per-student sheet opens. "Last activity" per
project is **deferred to v1.1** — adding it would require opening every
student sheet in every project just to render the list (N projects × M
students). The Dashboard's `asOf` timestamp gives the same information
once a teacher opens a specific project.

### Sort & filter

- Active/Archived toggle at the top (radio pills, default Active).
- Within each list, sorted by **schoolYear descending, then name
  ascending** — so the current year's projects float to the top.
- No search/filter beyond the toggle in v1.

### Empty states

- No staff entry → "Not authorized" panel (handled in §5).
- Staff but no projects in scope → "You're not on any active projects.
  Click + New project to create one."
- Archived list empty → "No archived projects."

## 7. Create Project modal

Triggered by `[+ New project]`. DOM overlay (not a GAS modal — this is a
single-page client app).

### Fields

1. **Name** — text input, required, 1–80 characters.
2. **School year** — `<select>`. Options: previous, current, next school
   year (computed from `new Date()`). Defaults to current.
3. **Bundle** — `<select>` populated from `listBundles_()`. v1: only one
   option (History Day).
4. **Member classes** — multi-select checkbox group. Options are distinct
   `Class` values from the Roster.
   - Teacher: shown only classes in their `teacherClasses`.
   - Admin: shown all distinct classes in the Roster.
   - Required: ≥1 selected.

### Submit

`[Create project]` button disabled until name is non-empty and ≥1 class
is checked. On click → `consoleCreateProject({name, schoolYear, bundleId,
memberClasses})`. Server validates (re-checks role, validates non-empty
name, validates bundleId exists, validates classes are non-empty) and
calls existing `createProject_`. Returns the new project shape.

Client adds the project to the top of the active list and closes the
modal. Validation errors render inline on the field.

## 8. Project Dashboard

The visual all-students table — the heart of Phase 4 for scanning 100+
rows at a glance.

### Layout

```
┌────────────────────────────────────────────────────────────────────────┐
│ ← My Projects     NHD 2026 · 7A · 21 students      [↻ Refresh]  17:42 │
├────────────────────────────────────────────────────────────────────────┤
│ STUDENT          CATEGORY MIX        COMPLETION  GAPS              ACT │
│ ───────          ────────────        ──────────  ────              ─── │
│ Smith, Alex      ▓▓▓░░░░░░░░░░░     ●●●●●●○○○○  cit:0 cls:1 ann:2  3m │
│ Johnson, Bri     ▓░░░░░░░░░░░░░     ●●○○○○○○○○  cit:5 cls:3 ann:4  1d │
│ Lee, Cam         ░░░░░░░░░░░░░░     ○○○○○○○○○○  cit:0 cls:0 ann:0   – │
│ Park, Dev        ▓▓▓▓▓▓░░░░░░░░     ●●●●●●●●●○  cit:1 cls:0 ann:0  17m│
└────────────────────────────────────────────────────────────────────────┘
```

### Per-row fields

- **Student name** — `"Last, First"` formatting derived from the Roster
  `Name` field (if it contains a space, split on the last space; else
  show as-is). Clicking anywhere on the row drills down.
- **Category mix** — fixed-width 140px horizontal stacked bar with 5
  colored segments in **bundle order** (`bundle.label1..label5`,
  `bundle.color1..color5`). Each segment's width = proportion of that
  student's primary-category highlights. Zero-highlight students render
  an empty gray-hatched bar of the same width — row shape stays
  consistent.
- **Completion** — 10-segment progress bar. Completion percentage =
  `sources where (citation complete AND classification set AND
  annotation non-empty) / total sources`. Color: green ≥80%, amber 40–
  79%, red <40%. Empty (no sources) → 10 empty rings.
- **Gaps** — three chips: `cit:N cls:N ann:N`. Thresholds: 0 = green,
  1–3 = amber, 4+ = red. Per build plan §"Teacher dashboard":
  "green = clear, amber = a few, red = many".
- **Activity** — relative timestamp of the student's most recent
  `createdAt` across `Sources` and `Highlights` tabs. Formats:
  - `<60s` → "just now"
  - `<60m` → "Nm ago"
  - `<24h` → "Nh ago"
  - `<7d` → "Nd ago"
  - older → "MMM D"
  - no activity → "—"

### Row shape consistency

CSS-enforced fixed widths: category bar 140px, completion 100px, gaps
180px, activity 70px. With 100 rows the table scans as a uniform grid.
No row varies in shape based on data.

### Sorting

Click any column header to sort ascending/descending. Default sort:
activity descending. Other sortable columns: name (alphabetical),
completion %, total highlights, total sources. Sort state lives in
component state only, not in the URL.

### Header bar

- `← My Projects` back link (URL hash → `#/projects`).
- Project name · class list · student count.
- `[↻ Refresh]` button — re-fires `consoleGetProjectDashboard`. Updates
  the timestamp. Also fires automatically on `window.addEventListener('focus', ...)`.
- Right-aligned clock: "last refreshed Ns ago" (live-updates every
  10 seconds via `setInterval`).

### Empty states

- No students enrolled in teacher's classes → "No students enrolled in
  your classes for this project."
- Students enrolled but zero data → table renders fully with all-"—"
  rows so teacher can confirm enrollment is right.

### Data source

`consoleGetProjectDashboard(projectId)` returns:

```js
{
  ok: true,
  project: { projectId, name, schoolYear, bundle, memberClasses },
  students: [
    {
      email, name, class,
      categoryMix: [{label, count, color}, ...],   // ordered by bundle
      sourceCount: 8,
      highlightCount: 23,
      completion: { percent: 75, sources: 6, total: 8 },
      gaps: { citation: 0, classification: 1, annotation: 2 },
      lastActivity: '2026-05-27T17:42:00Z' | null,
    },
    ...
  ],
  asOf: '2026-05-27T17:42:00Z',
}
```

Aggregates are computed server-side in `62_aggregator.js`. No raw
highlight/source data crosses the wire for the dashboard.

### Performance

25 students × ~150ms per Sheet open ≈ 4s. Comfortable. 100-student admin
view ≈ 15s — slow but tolerable for an admin who triggers it
deliberately. Cache only if it bites in pilot.

## 9. Student Drill-Down

Click a dashboard row. State transitions to `STUDENT`. URL hash:
`#/projects/<projectId>/students/<emailEncoded>`.

### Top section: 4 chart blocks

Responsive 2-column grid (stacks on narrow):

1. **Highlights-by-category bar chart** (Chart.js). Bundle's colors.
   X-axis: abbreviated category names (3–4 chars; full name on hover via
   Chart.js tooltips). Y-axis: highlight count. This is "the star" per
   the build plan; spans full width on narrow screens.
2. **Source counts** — two big-number tiles (primary / secondary) + a
   smaller "Unclassified: N" line. Pure CSS, no Chart.js.
3. **Completion breakdown** — three horizontal progress bars showing
   citation, classification, annotation completion. Same green/amber/red
   bands as the dashboard. Labels: "Citation complete: 6 / 8 sources",
   etc.
4. **Activity over time** — Chart.js dual-line chart, daily-binned.
   X-axis: calendar days from project creation to today. Two series:
   highlights, sources. Empty days are zero (not gaps).

### Bottom section: Sources & highlights viewer

Read-only adaptation of the sidebar's source-mode list. Per-source card:
- Title, classification chip, highlight count.
- Formatted MLA citation (via `formatCitation`, italics preserved with
  `<em>`).
- Completion icons: citation ✓/✗, annotation ✓/✗, classification ✓/✗.
- Highlights grouped by primary category:
  - Collapsed by default if total > 8 highlights.
  - Expanded by default if total ≤ 8.
  - Each highlight: color bar, category label, full text, note.

Default render shows top 5 sources by `createdAt` desc. A "Show all (N)"
button reveals the rest.

### Refresh & back

Same `[↻ Refresh]` + on-focus refresh pattern. Calls
`consoleGetStudentDetail` again. Back navigation: `← NHD 2026 / 7A`
breadcrumb returns to dashboard. Browser back button works too.

### Data source

`consoleGetStudentDetail(projectId, email)` returns:

```js
{
  ok: true,
  student: { email, name, class },
  aggregates: {
    categoryMix: [{label, count, color}, ...],
    sourceCounts: { primary: 4, secondary: 3, unset: 1 },
    completion: {
      citation:       { complete: 6, total: 8 },
      classification: { complete: 7, total: 8 },
      annotation:     { complete: 5, total: 8 },
    },
    activityByDay: [
      { date: '2025-09-15', sources: 1, highlights: 4 },
      ...
    ],
  },
  sources: [
    {
      sourceId, scrapedTitle, citationFieldsParsed,
      primarySecondary, annotation,
      formattedCitation: { text, italics },
      completionFlags: { citation: true, classification: true, annotation: false },
      highlights: [{highlightId, primaryCategory, secondaryCategory,
                    highlightedText, note, createdAt}, ...],
    },
    ...
  ],
  asOf: '...',
}
```

`formattedCitation` is precomputed server-side via the existing
`formatCitation` so the client doesn't need to know about citation
rendering.

## 10. Archive / Unarchive

`[⋯]` kebab on each project card opens a small popup menu.

**Archive (active project):**
- Menu item: "Archive…"
- Click → confirmation modal:
  > Archive "NHD 2026"? Student data stays put; the project disappears
  > from the extension's picker and stops accepting writes.
- Buttons: `[Cancel]` `[Archive]`.
- Confirm → `consoleArchiveProject(projectId)` → on success, the card
  animates out of the list.

**Unarchive (archived project):**
- Menu item: "Unarchive"
- Click → `consoleUnarchiveProject(projectId)` immediately (no
  confirmation — clearly reversible, reversal is the whole point).
- Card animates out of the archived list.

Both flow through the existing `archiveProject_` and `unarchiveProject_`
helpers in `12_projects.js`.

## 11. Server endpoints (new in `61_console_api.js`)

All endpoints:
- Call `getActorEmail_()` first.
- Throw `'Not authorized'` if `getStaffEntry_(actorEmail) === null`.
- Take simple primitives as args (no large JSON bodies — these are
  google.script.run calls).
- Return `{ ok: true, ... }` on success; let GAS surface failures via
  the failure handler.

Signatures:

```javascript
function consoleGetContext()
// → { ok, actor, staff, role, teacherClasses }

function consoleGetMyProjects(filter)        // filter: 'active' | 'archived'
// → { ok, projects: [...] }

function consoleCreateProject(args)
// args: { name, schoolYear, bundleId, memberClasses[] }
// → { ok, project }

function consoleArchiveProject(projectId)
// → { ok, projectId }

function consoleUnarchiveProject(projectId)
// → { ok, projectId }

function consoleGetProjectDashboard(projectId)
// → { ok, project, students: [{email, name, class, categoryMix, sourceCount,
//      highlightCount, completion, gaps, lastActivity}, ...], asOf }

function consoleGetStudentDetail(projectId, studentEmail)
// → { ok, student, aggregates: {...}, sources: [{... with formattedCitation
//      and highlights[]}, ...], asOf }
```

## 12. Aggregator (new in `62_aggregator.js`)

Pure functions. Take raw `sources[]` + `highlights[]` arrays + the
bundle, return aggregate shapes. No Sheet access — separation makes
unit testing trivial via editor-callable functions.

Functions:

- `aggregateStudent_(sources, highlights, bundle)` →
  `{ categoryMix, sourceCount, highlightCount, completion, gaps, lastActivity }`
  for one dashboard row.
- `aggregateStudentDetail_(sources, highlights, bundle)` →
  `{ categoryMix, sourceCounts, completion, activityByDay }` for the
  drill-down's chart blocks.
- `formatBundleCategoryMix_(highlights, bundle)` → ordered array of
  `{ label, count, color }` matching the bundle's `label1..label5` /
  `color1..color5` order. Ensures stack-bar and chart match bundle
  order regardless of insertion order.
- `computeCompletion_(sources)` →
  `{ citation: {complete, total}, classification: {...}, annotation: {...} }`.
  Citation complete = `citationFields` parsed JSON has at least `title`
  and `url` non-empty (no MLA validity check — that's a v2 concern).
  Classification set = `primarySecondary !== 'unset'`.
  Annotation = `annotation.trim().length > 0`.
- `computeGaps_(completion, total)` →
  `{ citation: N, classification: N, annotation: N }` where N = sources
  missing each field.
- `computeActivityByDay_(sources, highlights, projectCreatedAt)` →
  array of `{date, sources, highlights}` from project start to today.

## 13. Modifications to existing files

`apps-script/src/30_endpoints.js` — `doGet`:

```javascript
function doGet(e) {
  const params = (e && e.parameter) || {};
  if (!params.action) return serveConsoleHtml_();
  return jsonResponse_(handleGet_(e));
}
```

Everything else in `30_endpoints.js` unchanged. `doPost` unchanged.

## 14. Testing

### Editor-callable tests in `99_dev.js`

Per the project's GAS-V8 quirks convention, every new behavior gets a
`devTest*` function callable from the GAS editor:

- **`devTestConsoleAuth`** — seeds a non-staff actor; calls
  `consoleGetMyProjects`; asserts the throw. Re-seeds as staff; asserts
  it returns successfully.
- **`devTestConsoleProjectsFilter`** — seeds two projects (project A with
  class "7A", project B with class "7B"). Seeds actor as a teacher with
  `teacherClasses=['7A']`. Calls `consoleGetMyProjects('active')`;
  asserts only project A returned. Re-seeds actor as admin; asserts both
  returned.
- **`devTestAggregateStudent`** — hand-crafts a sources + highlights
  array with known properties (3 sources, 2 with complete citations, 1
  without; 5 highlights spread across 2 categories; activity spread over
  3 days). Calls `aggregateStudent_`; asserts categoryMix matches bundle
  order, sourceCount=3, completion.percent matches, gaps match,
  lastActivity is the latest createdAt.
- **`devTestConsoleCreateProject`** — calls `consoleCreateProject({
  name, schoolYear, bundleId, memberClasses: ['7A'] })`; asserts the
  project appears in `listProjects_` with the right shape. Cleans up.
- **`devTestConsoleDashboardEndToEnd`** — seeds 3 students with different
  patterns (lots of work, sparse work, no work). Calls
  `consoleGetProjectDashboard`; asserts 3 students returned with
  expected aggregate shapes.

### Manual QA checklist (in implementation plan)

- Sign in as staff (test deployment, dev OAuth) → console loads, no errors.
- See My Projects list with active projects only.
- Click Open on a project → Dashboard loads, table populates, asOf
  timestamp visible.
- Sort by each column header.
- Click a student row → Drill-down loads, 4 chart blocks render, Sources
  & highlights viewer shows full data.
- Click `← NHD 2026 / 7A` → back to dashboard.
- Browser back/forward → URL hash + view state restore correctly.
- Click `[↻ Refresh]` → timestamp updates, no flicker.
- Switch to another tab and back → on-focus refresh fires.
- Resize browser to narrow width → table stays scannable (horizontal
  scroll if needed); drill-down charts stack vertically.
- Click `[+ New project]` → modal opens.
  - Try invalid inputs (empty name, zero classes) → button stays
    disabled.
  - Submit valid input → modal closes, new project appears at top.
- Archive a project → confirmation prompt, confirm, project moves to
  Archived list (toggle).
- Unarchive → project returns to Active list.
- Open browser dev tools as a non-staff user (e.g., a student); paste
  `google.script.run.consoleGetMyProjects('active')` → server throws
  "Not authorized".
- Reload the Console URL as a non-staff user → "Not authorized" panel,
  no calls fired.

### Performance check

For the pilot section (~25 students), the dashboard should load in
< 6 seconds. If 100-student admin view exceeds 30 seconds, consider
caching as a follow-up (out of scope for this spec).

## 15. Out of scope (deferred sub-projects)

Per Phase 4 decomposition decided in brainstorming:

- **Sub-project C — Admin area + lifecycle:** roster management UI,
  bulk "Archive school year", project unarchive notification flow.
- **Sub-project D — Group management:** create/merge/un-merge group
  Sheets, data migration.
- **Sub-project E — Bundle authoring:** UI to define new bundles.

Each will get its own spec. The Console foundation built in this spec
will host them when they ship.

## 16. Out-of-scope reminders (project-wide, per CLAUDE.md §10)

- v1 MLA only.
- 4 source types (website, article, book, primary).
- No "insert as quote" button.
- Bundles immutable.
- Dashboard counts primary category only. Secondary tags affect sidebar
  filtering, never dashboard stats.

This spec does not touch any of those areas.
