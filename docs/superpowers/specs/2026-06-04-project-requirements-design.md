# Project Requirements — configurable targets that drive the dashboard

**Date:** 2026-06-04
**Status:** Design — approved pending spec review
**Surfaces touched:** Projects registry, pure aggregator, console API + UI, Docs
sidebar, extension in-page sidebar.

## 1. Problem

Today every project enforces the *same* implicit definition of "done": a source
counts as complete only when it has a citation **and** a primary/secondary
classification **and** an annotation ([`62_aggregator.js`](../../../apps-script/src/62_aggregator.js)
`computeCompletionSummary_`). There is no way for a teacher to say "this project
needs 5 sources," "each source needs at least 3 highlights across 2 categories,"
or "annotations aren't required this time." NHD, the 8th-grade capstone, and a
future AP Research project all have different expectations, and the dashboard
should measure each student against the bar the teacher actually set.

## 2. Goals / non-goals

**Goals**
- Let a teacher set four optional per-project requirements **at creation and edit
  them afterward**.
- Reflect those requirements in the teacher dashboard (row + drill-down) and in
  the student-facing sidebars.
- Change nothing for existing projects — an unset requirement behaves exactly as
  today.

**Non-goals (decided)**
- **No hard gates.** Requirements are *soft + nudges*: they reshape the metric
  and prompt the student; they never block saving and never change what the
  bibliography includes. The build-plan bibliography partition rule
  (`partitionBibliographySources_`) is untouched.
- No new citation styles, source types, or category mechanics.
- Secondary tags still never affect dashboard stats — "distinct categories"
  counts `primaryCategory` only, consistent with the existing
  "dashboard counts primary category only" rule.

## 3. The four settings

| Setting | Type | Scope | Unset means |
| --- | --- | --- | --- |
| `minSources` | int ≥ 1 | project / per-student | no source-count target |
| `minHighlightsPerSource` | int ≥ 1 | per-source | no highlight-count target |
| `minDistinctCategories` | int 1–5 | per-source | no breadth target |
| `requireAnnotation` | bool | project | **defaults `true`** (today's behavior) |

`minDistinctCategories` is capped at 5 (a bundle always has 5 labels).
`requireAnnotation` is the only one that defaults to a meaningful value, because
annotation is part of completion *today* — an existing project with no stored
requirements must keep requiring it.

## 4. Data model

One new **`requirements`** column appended to `HEADERS.PROJECTS`
([`02_constants.js`](../../../apps-script/src/02_constants.js)), holding a JSON
blob — same pattern as `citationFields` / `scrapedExtra`:

```json
{ "minSources": 5, "minHighlightsPerSource": 3, "minDistinctCategories": 2, "requireAnnotation": true }
```

- Keys are **omitted when unset** (except `requireAnnotation`, always written).
- Appended (not inserted), so the registry's positional `HEADERS` mapping is
  preserved and existing rows read the empty cell as `""`.
- A one-time `migrateAddRequirements_` (mirrors `migrateAddScrapedExtra_`) writes
  the header cell to the live Projects tab. Existing project rows need no
  backfill — an empty cell parses to defaults.

**Single parser, defined once** (heed the §5 shadowing trap — grep `src/` first):

```js
// parseProjectRequirements_(project) -> normalized, every key present
{ minSources: null, minHighlightsPerSource: null, minDistinctCategories: null, requireAnnotation: true }
```

Null = "no requirement." Lives in [`62_aggregator.js`](../../../apps-script/src/62_aggregator.js)
(pure, the primary consumer); console API, sidebar payloads, and the extension
all read through it. `getProject_` already loads the row, so threading the parsed
object costs nothing at call sites.

## 5. Metric semantics

Three independent readings. **When a project has no requirements set, all three
collapse to today's output byte-for-byte** (locked by a back-compat test).

### 5a. Completion % — still cite / tag / note, annotation now conditional

`computeCompletionSummary_`, `computeGaps_`, and `computeCompletion_` take the
parsed requirements. The only change: the **note** dimension participates only
when `requireAnnotation` is true.

- `requireAnnotation: true` (default) → identical to today.
- `requireAnnotation: false` → a source is "complete" on citation + classification
  alone; `gaps.annotation` is **not** reported; the **note** gap pill disappears
  from the row, drill-down, and sidebar.

The bibliography is *not* touched — turning annotations off moves the dashboard
metric and the note pill, nothing about what a Works Cited / annotated bib
includes.

### 5b. Evidence depth — new, separate per-source track

Only computed/surfaced when `minHighlightsPerSource` **or**
`minDistinctCategories` is set. New pure helper:

```js
computeEvidenceDepth_(sources, highlights, requirements)
// groups highlights by sourceId, then per source:
//   { sourceId, highlightCount, distinctCategoryCount,
//     meetsHighlights, meetsCategories, meets }
// + rollup: { targetSet, sourcesMeeting, total,
//             minHighlightsPerSource, minDistinctCategories }
```

`distinctCategoryCount` = count of distinct non-empty `primaryCategory` values on
that source's highlights. `meets` = both configured sub-targets cleared (an unset
sub-target is vacuously met). Never folded into completion %.

### 5c. Sources progress — new, project/per-student level

Only surfaced when `minSources` is set:

```js
{ minSources, sourceCount, meets: sourceCount >= minSources }
```

### Aggregator outputs

- `aggregateStudent_` (dashboard row) gains `sourcesProgress` and `evidenceDepth`
  (the rollup); its `completion`/`gaps` respect `requireAnnotation`.
- `aggregateStudentDetail_` (drill-down) gains `sourcesProgress` and the full
  per-source `evidenceDepth` list.
- The per-source `completionFlags` block built in `consoleGetStudentDetail`
  ([`61_console_api.js`](../../../apps-script/src/61_console_api.js)) gains an
  `evidence` sub-object: `{ highlights, needHighlights, categories, needCategories, meets }`.

## 6. Console API

- **`consoleCreateProject`** accepts `args.requirements`, validates (ints ≥ 1,
  `minDistinctCategories` ≤ 5, `requireAnnotation` coerced to bool), stores via
  `createProject_`.
- **`consoleUpdateProjectRequirements(projectId, requirements)`** — new.
  `assertStaff_`-gated (matches `consoleArchiveProject`'s staff-not-owner rule),
  validates identically, rewrites the project row's `requirements` cell
  (reusing the registry row-update path that `flipProjectStatus_` uses), writes
  an audit event. Returns the normalized requirements.
- Project payloads carry the parsed `requirements`: `createProject_`'s return,
  `consoleGetMyProjects` entries, the dashboard response, the `projects` GET
  action (so the extension's cached `state.project` has it), and
  `sidebarGetContext` / `sidebarGetProjectData`.

**Cache:** fold a short `requirements` fingerprint into the dashboard cache key
(`dash:v1:<projectId>:<classes>:<reqHash>:s0|s1`) so an edit can't be masked by
the 45 s TTL; the Edit action also refreshes with `bypassCache`.

## 7. Console UI ([`console_js.html`](../../../apps-script/src/console_js.html))

- **New-project form:** an *"Requirements (optional)"* fieldset — three number
  inputs (min sources, min highlights/source, min distinct categories/source,
  the last `max=5`) + an *Annotations required* toggle (default **on**). Blank
  inputs = unset. OPS-brand styling (reuse the existing toggle component).
- **Edit later:** an *"Edit requirements"* control on the project dashboard
  header opening a small modal with the same fieldset, calling
  `consoleUpdateProjectRequirements`, then a cache-bypassing dashboard refresh.

## 8. Dashboard + drill-down rendering

- **Row:** the sources cell shows `N / minSources` with met/unmet styling when
  set (raw count otherwise); a compact evidence-depth badge
  (`{sourcesMeeting}/{total} meet depth`) appears only when a depth target is
  set; gap pills = existing cite/tag/note (note hidden when annotations off) plus
  evidence pills, keeping the stoplight green/amber/red **for pills only** (per
  brand memory).
- **Drill-down:** each source row shows `3/3 highlights · 2/2 categories ✓` when
  depth targets are set; the header shows sources-progress and the depth rollup.

## 9. Student-facing surfaces

- **Extension in-page sidebar** ([`sidebar.js`](../../../extension/content/sidebar.js)) —
  page-scoped (one source = current page). Reads `state.project.requirements`
  (already carried) + local source/highlights:
  - *Source tab:* annotation field marked required/optional per `requireAnnotation`;
    a depth hint ("needs 1 more category to meet this project's target").
  - *Annotations tab:* a small "N of M highlights" / "k of j categories" line
    against the per-source targets. Pure DOM, no new endpoint.
- **Docs sidebar** ([`sidebar_js.html`](../../../apps-script/src/sidebar_js.html)) —
  has the full source list, so it carries the **overall** "X / N sources"
  progress plus a per-source depth recap, from `sidebarGetProjectData` (already
  returns sources + highlights) + the project's `requirements`.

## 10. Testing (pure `devTest*`, editor-callable)

- `devTestProjectRequirementsParse` — defaults, unset→null, bool coercion,
  range/cap validation.
- `devTestCompletionRespectsAnnotationToggle` — note dimension in/out of
  completion + gaps as `requireAnnotation` flips.
- `devTestEvidenceDepth` — per-source highlight/distinct-category counts, `meets`
  logic, target-set gating (no output when both depth targets unset).
- `devTestSourcesProgress` — count vs `minSources`.
- `devTestRequirementsBackCompat` — **keystone:** a project with no stored
  requirements yields aggregates byte-identical to the current code path.
- `devTestConsoleUpdateRequirements` — create → update → reread round-trip +
  validation rejects (touches the registry; cleans up after itself).

The console form, dashboard pills, and both sidebars are DOM-side — real-surface
QA only.

## 11. Migration / back-compat

- Add `requirements` to `HEADERS.PROJECTS`; run `migrateAddRequirements_` once to
  write the header cell. No row backfill.
- Every aggregate degrades to today's value when requirements are absent (locked
  by `devTestRequirementsBackCompat`).
- **Doc fix:** `CLAUDE.md` still describes the in-page sidebar as "code-complete
  on branch `sidebar-refresh`, not yet merged." That work is on `main`; correct
  the stale note as part of this change.

## 12. Open questions

- **Edit authorization granularity:** `consoleUpdateProjectRequirements` is gated
  on `assertStaff_` (any staff, like archive). If the pilot wants it
  owner/teacher-of-a-class-restricted, tighten later — documented, not built.
- **Per-source depth pill copy:** exact short labels for the evidence pills
  ("depth", "evidence", "breadth") to be settled during dashboard QA.
