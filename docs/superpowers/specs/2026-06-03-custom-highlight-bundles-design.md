# Custom highlight bundles — design

**Date:** 2026-06-03
**Status:** Draft for review
**Surfaces:** Teacher Console (project wizard), Chrome extension (toolbar +
in-page sidebar), Docs sidebar (read), Teacher dashboard, Apps Script backend.

## 1. Goal

When a teacher creates a project, the bundle (highlighter category set) field
offers three paths:

1. **Select an existing set** — already shipped (the current dropdown).
2. **Create a new set** — author a reusable 5-category bundle inline.
3. **Custom** — students define their own 5 `(color, label)` categories for
   themselves; the teacher imposes nothing.

This refines build-plan §Bundles, which assumed teacher-authored bundles only
and said "no `consoleCreateBundle` UI." Both gaps close here.

## 2. Decisions (settled with Paul, 2026-06-03)

- **Custom = students pick BOTH color and label** per category (not just a label
  over a fixed color). Consequence: colors do **not** align across students; the
  only stable cross-student anchor is the **slot index 1–5**.
- **Students define their custom categories in the in-page sidebar** (a new
  "Categories" editor), not the popup or inline toolbar.
- **Dashboard for custom projects:** each student's category stack-bar uses
  **their own colors + labels, aligned by slot**. Cross-student comparison is by
  volume/spread per slot, not by shared semantics.
- **"Create a new set" persists as a reusable, immutable Bundles-registry row**
  visible to all staff (matches the existing `createBundle_` model).
- **Teacher-authored sets pick colors from the fixed 8-swatch `PRESET_PALETTE`**
  (no free hex picker in v1).
- **Custom + Groups is DEFERRED** for v1 (see §10).
- **Proposed (flag at review):** the student color picker in the sidebar
  Categories editor also draws from the **8-swatch `PRESET_PALETTE`** — keeps
  highlight backgrounds legible and consistent, avoids a free hex picker. Veto
  if you want students to pick any color.

## 3. Data model

### 3.1 The reserved "Custom" bundle
One seeded Bundles row marks the Custom option:

- New **additive `custom` column** on the `Bundles` sheet (`HEADERS.BUNDLES`),
  self-migrating via `ensureHeaders_`'s trailing-append heal. Existing rows read
  blank/falsy.
- A `seedCustomBundle_()` (idempotent, mirrors `seedHistoryDayBundle_` in
  `40_seed_history_day.js`) creates a single row with `custom: true`, name
  `"Custom — student-defined"`, `style: 'mla'`, and **placeholder defaults**:
  `label1..5 = "Category 1".."Category 5"`, `color1..5 =` five distinct
  `PRESET_PALETTE` entries. These defaults are what a student sees before they
  customize.
- Detection is by the flag (`bundle.custom === true`), not a hardcoded id.

A custom project simply sets `project.bundleId` to this row's id. No per-project
teacher configuration.

### 3.2 Per-student personal bundle (custom projects only)
Each student's `(color, label)` choices are stored **per (student, project)** in
ScriptProperties via the existing user-pref mechanism:

- Key: `prefs:<emailLower>:customBundle:<projectId>`
  (`userPrefKey_` in `04_user_prefs.js`).
- Value: JSON `{ labels: [5 strings], colors: [5 palette hexes] }`. A label may
  be empty (student hasn't named that slot → display falls back to
  `"Category N"`).

**Why prefs, not Sheet columns:** the dashboard runs server-side in GAS and can
load every student's set in one `PropertiesService.getScriptProperties()
.getProperties()` scan (filter keys by the `:customBundle:<projectId>` suffix) —
no Meta-schema change, no extra CSV-export tab gid. Email-change rekeying
already rewrites `prefs:<oldEmail>:*` → `prefs:<newEmail>:*`
(`adminChangeStudentEmail`, `63_admin_api.js`), so personal bundles follow an
email change for free.

### 3.3 Slot anchor on highlights
Because students can **edit** their personal bundle after highlighting (rename a
label, change a color), the label string cannot be the category identity.

- New **additive `categorySlot` column** on the `Highlights` sheet
  (`HEADERS.HIGHLIGHTS`), self-migrating via `ensureHeaders_`. Values `1`–`5`
  for custom-project highlights; **blank for all non-custom highlights**.
- For custom projects, the toolbar writes BOTH `categorySlot` (the identity) and
  `primaryCategory` (a label snapshot, kept for label-based readers like the
  Docs bibliography that never display categories anyway).
- All category **displays** for custom projects (in-page sidebar facets,
  dashboard stack-bar) **re-derive** the current color + label from the
  student's personal bundle by slot — so an edit re-labels/re-colors that
  student's existing highlights live, with **zero row rewrites**.
- Non-custom projects: `categorySlot` blank; every existing code path
  (`colorForLabel_`, `formatBundleCategoryMix_`) behaves exactly as today.

`secondaryCategory` for custom projects keeps a label-only snapshot in v1 (it
never reaches the dashboard, per build-plan §10); it may drift on a label rename.
Documented limitation; a `secondarySlot` is out of scope.

## 4. Backend (Apps Script)

### 4.1 New endpoints
- **`consoleCreateBundle(args)`** (`61_console_api.js`): staff-gated
  (`assertStaff_`), thin wrapper over the existing `createBundle_`. Validates
  exactly 5 labels (non-empty) + 5 colors from `PRESET_PALETTE` + style. Returns
  the new bundle. (`createBundle_` already enforces all of this.) A matching
  `listBundlesForConsole` already exists for refreshing the picker.
- **doGet `action=customBundle&projectId=...`** (`30_endpoints.js`): returns the
  **active user's** personal bundle for that project (`{labels, colors}` or
  `null`). Read-only; identity from `Session`.
- **doPost `action=saveCustomBundle`** (`30_endpoints.js`,
  alongside the `setActiveProject` special-case): body
  `{action, projectId, labels:[5], colors:[5]}`. Validates the project is a
  custom project and colors ∈ palette; writes the pref under the active user.
  Does NOT open a Sheet.

### 4.2 Dashboard aggregation
- `formatBundleCategoryMix_` (`62_aggregator.js`) gains a custom mode: when the
  project bundle is `custom`, aggregate that student's highlights **by
  `categorySlot`** (not label), and render each segment's color + label from the
  **student's personal bundle** for that slot (placeholder if unset). Output
  stays the ordered `[{label, color, count}]` the stack-bar already consumes, so
  no console-side rendering change.
- `consoleGetProjectDashboard` (`61_console_api.js`) loads all scoped students'
  personal bundles in one `getProperties()` scan (helper
  `getCustomBundlesForProject_(projectId)` → `{emailLower → {labels, colors}}`)
  and threads each student's bundle into `aggregateStudent_` /
  `aggregateStudentDetail_`. The parallel CSV-export path and the serial
  fallback both get the same map; the `dash:` cache key is unaffected (personal
  bundles are read fresh server-side — cheap, and Refresh already bypasses).

### 4.3 Provisioning / seed
- `seedCustomBundle_()` runs in the same setup path that seeds History Day
  (`01_setup.js` / `40_seed_history_day.js`), idempotent.

## 5. Chrome extension

### 5.1 Effective bundle resolution
`getActiveProjectInfo` (`background.js`) currently resolves
`project.bundleId → bundle`. New behavior: when `bundle.custom`, fetch the
student's personal bundle (`apiGet({action:'customBundle', projectId})`, cached
as `cachedCustomBundle:<projectId>`) and build an **effective bundle** =
`{ ...customBundleDefaults, label_i/color_i overlaid from the student's pref }`.
The effective bundle is what's handed to the toolbar + sidebar as `ctx.bundle`,
so `colorForLabel_` and the swatch loop work unchanged.

### 5.2 Toolbar
`toolbar.js renderToolbar_` swatch loop is unchanged structurally (reads
`bundleCache.label_i/color_i`). On commit (`commitDraft_` / `syncHighlight_`),
for a custom project it additionally sends `categorySlot` (the 1–5 index of the
chosen swatch). Add `draftSlot` alongside `draftCategory`/`draftColor`.

### 5.3 In-page sidebar "Categories" editor (custom projects only)
A new collapsible section in `content/sidebar.js`, above the facet list, shown
only when `state.bundle.custom`:

- 5 rows, each: a **palette color picker** (8-swatch popover, matching the
  existing `.sb-*-pop` popover language) + a **name input** + the live count for
  that slot.
- Saves (debounced) via `chrome.runtime.sendMessage` → background →
  `apiPost saveCustomBundle`. On success, refresh `state.bundle` (effective) and
  re-render facets + any visible marks' labels.
- The facet list (`renderFacetList_`) and highlight rows derive color+label from
  slot for custom projects (so edits reflect immediately).

### 5.4 Popup
Bundle preview for a custom project shows a "Custom — set up your categories in
the sidebar" hint (or the student's personal swatches if set), instead of the
fixed swatch row.

## 6. Docs sidebar (Phase 3, read-only consumption)

`sidebarGetContext` / `sidebarGetProjectData` (`53_sidebar_api.js`) return the
**active user's** personal bundle when the project is custom, so the source
editor swatches and facets render the student's colors/labels. No editing here —
naming lives in the extension sidebar. Group sheets: see §10.

## 7. Teacher Console wizard

`openCreateProjectModal_` / `renderCreateModal_` (`console_js.html`): the Bundle
`<select>` gains two sentinel options after the real bundles:

- **"➕ Create new set…"** → reveals an inline sub-form: 5 rows of *name input +
  8-swatch palette picker*. On "Save set", calls `consoleCreateBundle`, then
  selects the returned bundle and continues project creation.
- **"✏️ Custom — students define their own"** → sets `fields.bundleId` to the
  reserved Custom bundle id (resolved from the bundles list by `custom === true`)
  and shows a one-line explainer. No further teacher input.

`listBundlesForConsole` should include the `custom` flag so the client can find
the reserved bundle and (optionally) label it distinctly in the list.

## 8. Schema changes (all additive, self-migrating — no migration script)

| Sheet | Column added | Written by | Back-compat |
| --- | --- | --- | --- |
| `Bundles` | `custom` | `seedCustomBundle_` | blank ⇒ normal bundle |
| `Highlights` | `categorySlot` | toolbar (custom only) | blank ⇒ label-based, as today |

Both rely on `ensureHeaders_`'s trailing-append heal (CLAUDE.md §4). Positional
column mapping via `HEADERS` keeps non-`ensureHeaders_` write paths correct.

## 9. Staging

One spec, two implementation stages (file-isolated enough to parallelize the
backend of A with the UI of B, but A is the natural first slice):

- **Stage A — Create-new-set.** `consoleCreateBundle` + wizard sub-form +
  `devTestConsoleCreateBundle`. Self-contained; ships value immediately.
- **Stage B — Custom.** Reserved bundle + `custom` column + per-student pref
  storage + `saveCustomBundle`/`customBundle` endpoints + `categorySlot` column +
  extension effective-bundle + sidebar Categories editor + toolbar slot + Docs
  sidebar read + dashboard slot aggregation.

## 10. Deferred / out of scope (v1)

- **Custom + Groups.** A group sheet holds multiple authors' highlights; with
  per-student colors, a group's categories are heterogeneous. v1: group
  drill-down on a custom project renders each highlight **best-effort by its
  author's** personal bundle if cheap, but cross-author category aggregation is
  **not** guaranteed. Documented limitation; revisit if the pilot needs it.
- **Free hex colors** (teacher sets and student custom) — palette only in v1.
- **`secondarySlot`** — secondary tags keep label snapshots; may drift on rename.
- **Editing/renaming existing bundles** — bundles remain immutable (build-plan
  §10). "Custom" is the escape hatch, not bundle mutation.

## 11. Testing

Editor-callable `devTest*` (per the project's TDD-for-GAS convention):

- `devTestConsoleCreateBundle` — staff gate + validation + round-trip read.
- `devTestSeedCustomBundle` — idempotent seed, `custom` flag set, defaults present.
- `devTestCustomBundlePrefRoundTrip` — `saveCustomBundle` write → `customBundle`
  read; partial labels; palette validation rejects off-palette colors.
- `devTestDashboardCustomBySlot` — a custom project with 2 students whose slot-1
  colors/labels differ aggregates **by slot** (each student's own colors/labels;
  counts correct).
- `devTestHighlightCategorySlotRoundTrip` — `categorySlot` writes/reads; blank
  for non-custom.
- Extend `devTestEnsureHeadersAppend` coverage for the two new columns
  (additive heal, reorder still throws).

DOM-side (no GAS test — real-page/real-Doc QA): the wizard sub-form, the sidebar
Categories editor + popover picker, toolbar slot capture, popup hint.

## 12. Implementation notes

- **Branch lineage to resolve at plan time:** `main`'s `extension/content/
  sidebar.js` already contains the Source-tab/facet refresh, but CLAUDE.md says
  that work lives on an unmerged `sidebar-refresh` branch. Confirm the true state
  and build the Categories editor on whatever branch carries the current in-page
  sidebar; this feature should land on its own feature branch off that.
- **Unrelated uncommitted work:** the per-student Sheet-naming change
  (`<project> — Research — <email>`) is in the working tree (already pushed +
  deployed). Commit or stash it before branching so it doesn't ride along.
- **Keep the dashboard rule single-sourced:** `formatBundleCategoryMix_` stays
  the one place category counting lives (build-plan §10: primary category only).

## 13. Non-goals (unchanged guardrails)

v1 MLA only; 4 source types; no "insert as quote"; no re-anchoring; bundles
immutable; dashboard counts primary category only.
