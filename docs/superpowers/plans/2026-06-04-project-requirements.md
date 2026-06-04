# Project Requirements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let teachers set four optional per-project requirements (min sources, min highlights/source, min distinct categories/source, annotations required) at creation and edit them later, and reflect them in the dashboard, drill-down, and student sidebars — soft targets only, no hard gates.

**Architecture:** A new `requirements` JSON column on the Projects registry row, parsed by one pure helper. The pure aggregator ([62_aggregator.js](../../../apps-script/src/62_aggregator.js)) gains an annotation-conditional completion metric plus two new readings (evidence depth, sources progress), all additive and inert when nothing is set. Console endpoints validate/persist/serve the requirements; the console UI and both sidebars render against them. Backend logic is TDD'd via editor-callable `devTest*`; UI is DOM/QA-only.

**Tech Stack:** Google Apps Script (V8, no modules — single global namespace), vanilla JS console + sidebar HTML, `clasp` push/redeploy.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| [`apps-script/src/02_constants.js`](../../../apps-script/src/02_constants.js) | Schema | Add `requirements` to `HEADERS.PROJECTS` |
| [`apps-script/src/62_aggregator.js`](../../../apps-script/src/62_aggregator.js) | Pure metrics | `parseProjectRequirements_`, annotation-conditional completion, `computeEvidenceDepth_`, `computeSourcesProgress_`, thread through `aggregateStudent_`/`aggregateStudentDetail_` |
| [`apps-script/src/12_projects.js`](../../../apps-script/src/12_projects.js) | Registry CRUD | `createProject_` stores `requirements`; `migrateAddRequirements_` |
| [`apps-script/src/61_console_api.js`](../../../apps-script/src/61_console_api.js) | Console API | `validateRequirementsInput_`, `consoleCreateProject` + `consoleUpdateProjectRequirements`, thread requirements into dashboard compute + payloads + cache key |
| [`apps-script/src/30_endpoints.js`](../../../apps-script/src/30_endpoints.js) | Extension API | `projects` GET action returns parsed `requirements` |
| [`apps-script/src/53_sidebar_api.js`](../../../apps-script/src/53_sidebar_api.js) | Docs sidebar API | `sidebarGetContext` + `sidebarGetProjectData` return `requirements` |
| [`apps-script/src/03_utils.js`](../../../apps-script/src/03_utils.js) | Utils | `shortHash_` (cache-key fingerprint) |
| [`apps-script/src/99_dev.js`](../../../apps-script/src/99_dev.js) | Tests | 6 new `devTest*` + register in suite runner |
| [`apps-script/src/console_js.html`](../../../apps-script/src/console_js.html) | Console UI | Requirements fieldset (create + edit modal), dashboard row pills, drill-down evidence |
| [`apps-script/src/console_css.html`](../../../apps-script/src/console_css.html) | Console styles | Pill/badge styles |
| [`extension/content/sidebar.js`](../../../extension/content/sidebar.js) | In-page sidebar | Per-source nudges |
| [`apps-script/src/sidebar_js.html`](../../../apps-script/src/sidebar_js.html) | Docs sidebar | Sources-progress + per-source depth recap |
| [`CLAUDE.md`](../../../CLAUDE.md) | Docs | Fix stale `sidebar-refresh` note; record feature |

**Conventions (read before starting):**
- GAS shares ONE global namespace — before adding any `function foo_()`, grep `apps-script/src` for an existing `foo_`; a duplicate silently shadows (last-loaded file wins). See CLAUDE.md §5.
- `devTest*` are run from the GAS editor (Run ▸ function). They print `PASS`/`FAIL` lines + an `N/M passed` summary to the execution log. There is no `node`/`pytest` runner for these — "run the test" means **run the function in the Apps Script editor and read the log**. (One pure test, `apps-script/test/roster_model.node.test.js`, runs under node, but everything here is editor-run.)
- Each task commits with `git add <files>; git commit -m "..."`. End commit messages with the `Co-Authored-By` line used in this repo.

---

## Task 1: Schema + requirements parser (pure)

**Files:**
- Modify: `apps-script/src/02_constants.js:41-44` (append `requirements` to `HEADERS.PROJECTS`)
- Modify: `apps-script/src/62_aggregator.js` (add `parseProjectRequirements_`)
- Modify: `apps-script/src/99_dev.js` (add `devTestProjectRequirementsParse`)

- [ ] **Step 1: Add the column to the schema**

In `apps-script/src/02_constants.js`, change the `PROJECTS` header array to append `requirements`:

```js
  PROJECTS: [
    'projectId', 'name', 'schoolYear', 'bundleId', 'memberClasses',
    'status', 'rootFolderId', 'createdBy', 'createdAt',
    // Appended (positional mapping preserved). JSON blob of optional teacher
    // requirements: minSources / minHighlightsPerSource / minDistinctCategories
    // / requireAnnotation. Empty cell on existing rows → parser defaults.
    'requirements',
  ],
```

- [ ] **Step 2: Write the failing test**

In `apps-script/src/99_dev.js`, add:

```js
function devTestProjectRequirementsParse() {
  let pass = 0, fail = 0;
  const check = (l, c) => { if (c) { pass++; console.log('PASS ' + l); } else { fail++; console.log('FAIL ' + l); } };

  const a = parseProjectRequirements_({});
  check('empty → minSources null',            a.minSources === null);
  check('empty → minHighlights null',         a.minHighlightsPerSource === null);
  check('empty → minDistinct null',           a.minDistinctCategories === null);
  check('empty → requireAnnotation true',     a.requireAnnotation === true);

  const b = parseProjectRequirements_({ requirements: JSON.stringify({
    minSources: 5, minHighlightsPerSource: 3, minDistinctCategories: 2, requireAnnotation: false }) });
  check('parsed minSources 5',                b.minSources === 5);
  check('parsed minHighlights 3',             b.minHighlightsPerSource === 3);
  check('parsed minDistinct 2',               b.minDistinctCategories === 2);
  check('parsed requireAnnotation false',     b.requireAnnotation === false);

  const c = parseProjectRequirements_({ requirements: JSON.stringify({
    minDistinctCategories: 9, minSources: 0, minHighlightsPerSource: -2 }) });
  check('minDistinct capped at 5',            c.minDistinctCategories === 5);
  check('minSources 0 → null',                c.minSources === null);
  check('negative minHighlights → null',      c.minHighlightsPerSource === null);

  const d = parseProjectRequirements_({ requirements: 'not json' });
  check('malformed → defaults',               d.minSources === null && d.requireAnnotation === true);

  console.log(pass + '/' + (pass + fail) + ' passed');
}
```

- [ ] **Step 3: Run it — expect FAIL**

Run `devTestProjectRequirementsParse` in the GAS editor.
Expected: throws `ReferenceError: parseProjectRequirements_ is not defined` (or all FAIL).

- [ ] **Step 4: Implement the parser**

In `apps-script/src/62_aggregator.js`, add near the top (after the file header comment), reusing `parseJsonColumn_` from `03_utils.js`:

```js
/**
 * Parse + normalize a project's `requirements` JSON. Every key is present in
 * the output: null = "no requirement". `requireAnnotation` defaults TRUE —
 * existing projects (empty cell) must keep requiring annotation, today's behavior.
 * Pure. Single definition (grep before adding a same-named helper — §5 shadow trap).
 */
function parseProjectRequirements_(project) {
  const raw = project ? parseJsonColumn_(project.requirements) : {};
  const posInt = (v) => {
    const n = Math.floor(Number(v));
    return (isFinite(n) && n >= 1) ? n : null;
  };
  const cats = posInt(raw.minDistinctCategories);
  return {
    minSources:             posInt(raw.minSources),
    minHighlightsPerSource: posInt(raw.minHighlightsPerSource),
    minDistinctCategories:  cats === null ? null : Math.min(cats, 5),
    requireAnnotation:      raw.requireAnnotation === false ? false : true,
  };
}
```

- [ ] **Step 5: Run it — expect 12/12 passed**

Run `devTestProjectRequirementsParse`. Expected: every line `PASS`, final `12/12 passed`.

- [ ] **Step 6: Commit**

```bash
git add apps-script/src/02_constants.js apps-script/src/62_aggregator.js apps-script/src/99_dev.js
git commit -m "feat(requirements): project requirements schema column + pure parser"
```

---

## Task 2: Aggregator — conditional completion, evidence depth, sources progress (pure)

**Files:**
- Modify: `apps-script/src/62_aggregator.js` (`computeCompletionSummary_`, new `computeEvidenceDepth_` + `computeSourcesProgress_`, `aggregateStudent_`, `aggregateStudentDetail_`)
- Modify: `apps-script/src/99_dev.js` (4 new tests)

**Design note:** Only the headline completion % respects `requireAnnotation`. `computeGaps_` and `computeCompletion_` keep their shape (the note pill / annotation bar are hidden in the UI via the `requireAnnotation` flag, not by mutating these outputs) — this keeps back-compat trivial. New aggregate keys (`sourcesProgress`, `evidenceDepth`) are additive and inert when no target is set.

- [ ] **Step 1: Write the failing tests**

In `apps-script/src/99_dev.js`, add all four:

```js
function devTestCompletionRespectsAnnotationToggle() {
  let pass = 0, fail = 0;
  const check = (l, c) => { if (c) { pass++; console.log('PASS ' + l); } else { fail++; console.log('FAIL ' + l); } };
  const sources = [
    { sourceId: 's1', primarySecondary: 'primary',   annotation: '', citationFields: JSON.stringify({ title: 'A', url: 'u' }) },
    { sourceId: 's2', primarySecondary: 'secondary', annotation: '', citationFields: JSON.stringify({ title: 'B', url: 'u' }) },
  ];
  const on  = computeCompletionSummary_(sources, parseProjectRequirements_({}));
  check('annotations required → 0 complete', on.complete === 0);
  const off = computeCompletionSummary_(sources, parseProjectRequirements_({ requirements: JSON.stringify({ requireAnnotation: false }) }));
  check('annotations optional → 2 complete', off.complete === 2);
  check('annotations optional → 100%',       off.percent === 100);
  console.log(pass + '/' + (pass + fail) + ' passed');
}

function devTestEvidenceDepth() {
  let pass = 0, fail = 0;
  const check = (l, c) => { if (c) { pass++; console.log('PASS ' + l); } else { fail++; console.log('FAIL ' + l); } };
  const sources = [{ sourceId: 's1' }, { sourceId: 's2' }, { sourceId: 's3' }];
  const highlights = [
    { sourceId: 's1', primaryCategory: 'A' }, { sourceId: 's1', primaryCategory: 'B' }, { sourceId: 's1', primaryCategory: 'A' }, // s1: 3 hl, 2 cats
    { sourceId: 's2', primaryCategory: 'A' }, // s2: 1 hl, 1 cat
    // s3: nothing
  ];
  const d = computeEvidenceDepth_(sources, highlights, { minHighlightsPerSource: 2, minDistinctCategories: 2 });
  check('targetSet true',            d.targetSet === true);
  check('total 3',                   d.total === 3);
  check('s1 highlightCount 3',       d.perSource[0].highlightCount === 3);
  check('s1 distinct 2',             d.perSource[0].distinctCategoryCount === 2);
  check('s1 meets',                  d.perSource[0].meets === true);
  check('s2 fails (1hl,1cat)',       d.perSource[1].meets === false);
  check('s3 fails (empty)',          d.perSource[2].meets === false);
  check('sourcesMeeting 1',          d.sourcesMeeting === 1);

  const none = computeEvidenceDepth_(sources, highlights, {});
  check('no target → targetSet false', none.targetSet === false);
  check('no target → all meet',        none.sourcesMeeting === 3);

  const onlyH = computeEvidenceDepth_(sources, highlights, { minHighlightsPerSource: 2 });
  check('onlyH: s1 meets',           onlyH.perSource[0].meets === true);
  check('onlyH: s2 fails',           onlyH.perSource[1].meets === false);
  console.log(pass + '/' + (pass + fail) + ' passed');
}

function devTestSourcesProgress() {
  let pass = 0, fail = 0;
  const check = (l, c) => { if (c) { pass++; console.log('PASS ' + l); } else { fail++; console.log('FAIL ' + l); } };
  const three = [{ sourceId: 'a' }, { sourceId: 'b' }, { sourceId: 'c' }];
  const p1 = computeSourcesProgress_(three, { minSources: 5 });
  check('3 of 5 → not meets', p1.meets === false && p1.sourceCount === 3 && p1.minSources === 5);
  const p2 = computeSourcesProgress_(three, { minSources: 3 });
  check('3 of 3 → meets',     p2.meets === true);
  const p3 = computeSourcesProgress_(three, {});
  check('no target → meets, null', p3.meets === true && p3.minSources === null);
  console.log(pass + '/' + (pass + fail) + ' passed');
}

function devTestRequirementsBackCompat() {
  let pass = 0, fail = 0;
  const check = (l, c) => { if (c) { pass++; console.log('PASS ' + l); } else { fail++; console.log('FAIL ' + l); } };
  const bundle = { bundleId: 'b', name: 'B', style: 'mla',
    label1: 'Background', color1: '#1', label2: 'Build-Up', color2: '#2',
    label3: 'Main Event', color3: '#3', label4: 'Short', color4: '#4', label5: 'Long', color5: '#5' };
  const sources = [
    { sourceId: 's1', primarySecondary: 'primary',   annotation: 'Good.', citationFields: JSON.stringify({ title: 'A', url: 'https://a' }), createdAt: '2026-05-20T10:00:00Z' },
    { sourceId: 's2', primarySecondary: 'secondary', annotation: '',      citationFields: JSON.stringify({ title: 'B', url: 'https://b' }), createdAt: '2026-05-21T10:00:00Z' },
    { sourceId: 's3', primarySecondary: 'unset',     annotation: 'N.',    citationFields: JSON.stringify({ title: '', url: '' }),          createdAt: '2026-05-22T10:00:00Z' },
  ];
  const highlights = [{ sourceId: 's1', primaryCategory: 'Background', createdAt: '2026-05-20T11:00:00Z' }];
  // No requirements arg → must match the known-good values from devTestAggregateStudent.
  const agg = aggregateStudent_(sources, highlights, bundle);
  check('completion.complete still 1',  agg.completion.complete === 1);
  check('completion.percent still 33',  agg.completion.percent === 33);
  check('gaps.annotation still 1',      agg.gaps.annotation === 1);
  check('sourcesProgress inert',        agg.sourcesProgress.meets === true && agg.sourcesProgress.minSources === null);
  check('evidenceDepth inert',          agg.evidenceDepth.targetSet === false);
  console.log(pass + '/' + (pass + fail) + ' passed');
}
```

- [ ] **Step 2: Run them — expect FAIL**

Run each of the four in the editor. Expected: `computeEvidenceDepth_`/`computeSourcesProgress_` undefined; `computeCompletionSummary_` arity FAIL.

- [ ] **Step 3: Make completion annotation-conditional**

In `apps-script/src/62_aggregator.js`, replace `computeCompletionSummary_` (currently lines ~103-118) with:

```js
/**
 * Headline completion for the dashboard row:
 *   percent = sources where ALL of (citation, classification, AND — only when
 *   the project requires it — annotation) / total. Zero sources → 0%.
 * `requirements` is the normalized object from parseProjectRequirements_ (or
 * undefined for the legacy no-requirements behavior, which requires annotation).
 */
function computeCompletionSummary_(sources, requirements) {
  if (sources.length === 0) return { percent: 0, complete: 0, total: 0 };
  const needAnn = !requirements || requirements.requireAnnotation !== false;
  let complete = 0;
  sources.forEach((s) => {
    const parsed = parseCitationFields_(s);
    const citationOk = parsed.title && parsed.url;
    const classOk = s.primarySecondary && s.primarySecondary !== 'unset';
    const annOk = !needAnn || (s.annotation && String(s.annotation).trim().length > 0);
    if (citationOk && classOk && annOk) complete++;
  });
  return {
    percent: Math.round((complete / sources.length) * 100),
    complete,
    total: sources.length,
  };
}
```

- [ ] **Step 4: Add the two new pure readings**

In `apps-script/src/62_aggregator.js`, add (after `computeCompletionSummary_`):

```js
/**
 * Per-source "evidence depth" against the optional per-source targets. Only
 * meaningful when minHighlightsPerSource and/or minDistinctCategories is set
 * (targetSet). distinctCategoryCount counts distinct non-empty primaryCategory
 * — secondary tags never count (dashboard counts primary only). An unset
 * sub-target is vacuously met. Pure.
 */
function computeEvidenceDepth_(sources, highlights, requirements) {
  const req = requirements || {};
  const minH = req.minHighlightsPerSource || null;
  const minC = req.minDistinctCategories || null;
  const bySource = {};
  highlights.forEach((h) => {
    const sid = h.sourceId;
    if (!bySource[sid]) bySource[sid] = { count: 0, cats: {} };
    bySource[sid].count++;
    if (h.primaryCategory) bySource[sid].cats[h.primaryCategory] = true;
  });
  const perSource = sources.map((s) => {
    const g = bySource[s.sourceId] || { count: 0, cats: {} };
    const distinct = Object.keys(g.cats).length;
    const meetsHighlights = minH ? g.count >= minH : true;
    const meetsCategories = minC ? distinct >= minC : true;
    return {
      sourceId: s.sourceId,
      highlightCount: g.count,
      distinctCategoryCount: distinct,
      meetsHighlights,
      meetsCategories,
      meets: meetsHighlights && meetsCategories,
    };
  });
  return {
    targetSet: !!(minH || minC),
    minHighlightsPerSource: minH,
    minDistinctCategories: minC,
    total: sources.length,
    sourcesMeeting: perSource.filter((p) => p.meets).length,
    perSource,
  };
}

/** Project-level source-count progress against optional minSources. Pure. */
function computeSourcesProgress_(sources, requirements) {
  const min = (requirements && requirements.minSources) || null;
  return {
    minSources: min,
    sourceCount: sources.length,
    meets: min ? sources.length >= min : true,
  };
}
```

- [ ] **Step 5: Thread requirements through the two aggregate entry points**

In `apps-script/src/62_aggregator.js`, replace `aggregateStudent_` (lines ~20-29) and `aggregateStudentDetail_` (lines ~34-41) with:

```js
function aggregateStudent_(sources, highlights, bundle, requirements) {
  const req = requirements || parseProjectRequirements_({});
  const depth = computeEvidenceDepth_(sources, highlights, req);
  return {
    categoryMix: formatBundleCategoryMix_(highlights, bundle),
    sourceCount: sources.length,
    highlightCount: highlights.length,
    completion: computeCompletionSummary_(sources, req),
    gaps: computeGaps_(sources),
    sourcesProgress: computeSourcesProgress_(sources, req),
    // Row payload: rollup only (omit perSource to keep the dashboard response small).
    evidenceDepth: {
      targetSet: depth.targetSet,
      total: depth.total,
      sourcesMeeting: depth.sourcesMeeting,
      minHighlightsPerSource: depth.minHighlightsPerSource,
      minDistinctCategories: depth.minDistinctCategories,
    },
    lastActivity: computeLastActivity_(sources, highlights),
  };
}

function aggregateStudentDetail_(sources, highlights, bundle, projectCreatedAt, requirements) {
  const req = requirements || parseProjectRequirements_({});
  return {
    categoryMix: formatBundleCategoryMix_(highlights, bundle),
    sourceCounts: computeSourceCounts_(sources),
    completion: computeCompletion_(sources),
    sourcesProgress: computeSourcesProgress_(sources, req),
    // Drill-down: full per-source list so the viewer can annotate each source.
    evidenceDepth: computeEvidenceDepth_(sources, highlights, req),
    requireAnnotation: req.requireAnnotation,
    activityByDay: computeActivityByDay_(sources, highlights, projectCreatedAt),
  };
}
```

- [ ] **Step 6: Run all four tests + the existing `devTestAggregateStudent` — expect all PASS**

Run `devTestCompletionRespectsAnnotationToggle`, `devTestEvidenceDepth`, `devTestSourcesProgress`, `devTestRequirementsBackCompat`, and the pre-existing `devTestAggregateStudent`. Expected: every one ends in all-`PASS` (the existing test still passes because the new 4th param defaults to no-requirements).

- [ ] **Step 7: Commit**

```bash
git add apps-script/src/62_aggregator.js apps-script/src/99_dev.js
git commit -m "feat(requirements): annotation-conditional completion + evidence-depth + sources-progress aggregates"
```

---

## Task 3: Persist + validate in the registry/endpoints

**Files:**
- Modify: `apps-script/src/12_projects.js` (`createProject_` stores requirements; add `migrateAddRequirements_`)
- Modify: `apps-script/src/61_console_api.js` (`validateRequirementsInput_`, `consoleUpdateProjectRequirements`, wire `consoleCreateProject`)
- Modify: `apps-script/src/99_dev.js` (validation + round-trip tests)

- [ ] **Step 1: Write the failing validation test**

In `apps-script/src/99_dev.js`, add:

```js
function devTestRequirementsValidation() {
  let pass = 0, fail = 0;
  const check = (l, c) => { if (c) { pass++; console.log('PASS ' + l); } else { fail++; console.log('FAIL ' + l); } };
  const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };

  const ok = validateRequirementsInput_({ minSources: '5', minHighlightsPerSource: 3, minDistinctCategories: 2, requireAnnotation: false });
  check('coerces "5" → 5',              ok.minSources === 5);
  check('keeps requireAnnotation false', ok.requireAnnotation === false);

  const blank = validateRequirementsInput_({ minSources: '', requireAnnotation: true });
  check('blank minSources omitted',     blank.minSources === undefined);
  check('default requireAnnotation true', blank.requireAnnotation === true);

  check('rejects minSources 0',         throws(() => validateRequirementsInput_({ minSources: 0 })));
  check('rejects negative',             throws(() => validateRequirementsInput_({ minHighlightsPerSource: -1 })));
  check('rejects minDistinct 6',        throws(() => validateRequirementsInput_({ minDistinctCategories: 6 })));
  check('rejects non-numeric',          throws(() => validateRequirementsInput_({ minSources: 'lots' })));
  console.log(pass + '/' + (pass + fail) + ' passed');
}
```

- [ ] **Step 2: Run it — expect FAIL** (`validateRequirementsInput_` undefined).

- [ ] **Step 3: Add the validator**

In `apps-script/src/61_console_api.js`, add near `consoleCreateProject` (grep first — name must be unique):

```js
/**
 * Validate raw requirements form input → a compact object suitable for
 * JSON.stringify into the registry. Unset (blank/undefined) numeric fields are
 * OMITTED; requireAnnotation always present (defaults true). Throws on a bad
 * number so the teacher gets a clear message. Pure.
 */
function validateRequirementsInput_(raw) {
  raw = raw || {};
  const out = {};
  const intField = (v, label, max) => {
    if (v === '' || v === null || v === undefined) return undefined;  // unset
    const n = Math.floor(Number(v));
    if (!isFinite(n) || n < 1) throw new Error(label + ' must be a whole number ≥ 1');
    if (max && n > max) throw new Error(label + ' cannot exceed ' + max);
    return n;
  };
  const ms = intField(raw.minSources, 'Min sources');                          if (ms !== undefined) out.minSources = ms;
  const mh = intField(raw.minHighlightsPerSource, 'Min highlights per source'); if (mh !== undefined) out.minHighlightsPerSource = mh;
  const mc = intField(raw.minDistinctCategories, 'Min distinct categories', 5); if (mc !== undefined) out.minDistinctCategories = mc;
  out.requireAnnotation = raw.requireAnnotation === false ? false : true;
  return out;
}
```

- [ ] **Step 4: Run `devTestRequirementsValidation` — expect all PASS.**

- [ ] **Step 5: Store requirements at creation**

In `apps-script/src/12_projects.js`, update `createProject_`'s signature + project object:

```js
function createProject_({ name, schoolYear, bundleId, memberClasses, createdBy, requirements }) {
```

and in the `project` literal (after `createdAt: nowIso_(),`) add:

```js
    requirements: JSON.stringify(requirements || { requireAnnotation: true }),
```

- [ ] **Step 6: Add the registry header migration**

In `apps-script/src/12_projects.js`, add at the end:

```js
/**
 * One-time (idempotent): ensure the Projects tab header row carries the
 * trailing `requirements` column. ensureHeaders_ appends a missing trailing
 * label and is a no-op once present. Existing rows need no backfill — an empty
 * cell parses to defaults. Run once from the editor after deploy.
 */
function migrateAddRequirements_() {
  const ss = SpreadsheetApp.openById(CONFIG.PROJECTS_SHEET_ID);
  ensureHeaders_(getTab_(ss, TABS.PROJECTS), HEADERS.PROJECTS);
  return { ok: true, headers: HEADERS.PROJECTS };
}
```

- [ ] **Step 7: Wire `consoleCreateProject` + add the update endpoint**

In `apps-script/src/61_console_api.js` `consoleCreateProject`, after the `memberClasses` validation block and before `const project = createProject_({`, add:

```js
  const requirements = validateRequirementsInput_(args.requirements);
```

change the `createProject_({...})` call to pass it:

```js
  const project = createProject_({
    name, schoolYear, bundleId, memberClasses,
    createdBy: actorEmail, requirements,
  });
```

and add `requirements` to the returned `project` object (after `status: project.status,`):

```js
      requirements: parseProjectRequirements_(project),
```

Then add the new endpoint after `consoleUnarchiveProject`:

```js
/**
 * Edit a project's requirements after creation. Soft settings — staff-gated
 * (any staff, like archive/unarchive), no class-ownership restriction. Rewrites
 * only the requirements cell. Returns the normalized requirements.
 */
function consoleUpdateProjectRequirements(projectId, requirements) {
  const actorEmail = getActorEmail_();
  assertStaff_(actorEmail);
  if (!projectId) throw new Error('projectId required');
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown project ' + projectId);
  const validated = validateRequirementsInput_(requirements);
  const ss = SpreadsheetApp.openById(CONFIG.PROJECTS_SHEET_ID);
  const tab = getTab_(ss, TABS.PROJECTS);
  ensureHeaders_(tab, HEADERS.PROJECTS);   // heals the trailing column if absent
  const rowIdx = findRowByKey_(tab, HEADERS.PROJECTS, 'projectId', projectId);
  if (rowIdx < 0) throw new Error('Unknown projectId ' + projectId);
  const col = HEADERS.PROJECTS.indexOf('requirements') + 1;
  const json = JSON.stringify(validated);
  tab.getRange(rowIdx, col).setValue(json);
  return { ok: true, projectId, requirements: parseProjectRequirements_({ requirements: json }) };
}
```

- [ ] **Step 8: Write + run the round-trip test**

In `apps-script/src/99_dev.js`, add (needs the Dev Project — run `devSeedDevProject` first if absent):

```js
function devTestConsoleUpdateRequirements() {
  let pass = 0, fail = 0;
  const check = (l, c) => { if (c) { pass++; console.log('PASS ' + l); } else { fail++; console.log('FAIL ' + l); } };
  const proj = listActiveProjects_().find((p) => /dev/i.test(p.name));
  if (!proj) { console.log('FAIL no Dev Project — run devSeedDevProject first'); return; }

  consoleUpdateProjectRequirements(proj.projectId, { minSources: 4, minHighlightsPerSource: 2, minDistinctCategories: 3, requireAnnotation: false });
  const after = parseProjectRequirements_(getProject_(proj.projectId));
  check('minSources persisted 4',        after.minSources === 4);
  check('minHighlights persisted 2',     after.minHighlightsPerSource === 2);
  check('minDistinct persisted 3',       after.minDistinctCategories === 3);
  check('requireAnnotation persisted false', after.requireAnnotation === false);

  // Reset to defaults so the Dev Project dashboard is unchanged for other tests.
  consoleUpdateProjectRequirements(proj.projectId, { requireAnnotation: true });
  const reset = parseProjectRequirements_(getProject_(proj.projectId));
  check('reset → minSources null',       reset.minSources === null);
  check('reset → requireAnnotation true', reset.requireAnnotation === true);
  console.log(pass + '/' + (pass + fail) + ' passed');
}
```

Run `migrateAddRequirements_` once, then `devTestConsoleUpdateRequirements`. Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add apps-script/src/12_projects.js apps-script/src/61_console_api.js apps-script/src/99_dev.js
git commit -m "feat(requirements): persist at creation + consoleUpdateProjectRequirements + validation"
```

---

## Task 4: Serve requirements through dashboard compute + all payloads

**Files:**
- Modify: `apps-script/src/03_utils.js` (`shortHash_`)
- Modify: `apps-script/src/61_console_api.js` (dashboard compute call sites + cache key + `consoleGetMyProjects` + dashboard resp.project)
- Modify: `apps-script/src/30_endpoints.js` (`projects` action)
- Modify: `apps-script/src/53_sidebar_api.js` (`sidebarGetContext` + `sidebarGetProjectData`)

- [ ] **Step 1: Add a cache-key hash helper**

In `apps-script/src/03_utils.js`, add (grep first):

```js
/** Tiny stable string hash (djb2) → base36. For cache-key fingerprints. */
function shortHash_(str) {
  let h = 5381;
  const s = String(str);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
```

- [ ] **Step 2: Thread requirements into both dashboard compute paths**

In `apps-script/src/61_console_api.js`, at the top of `computeDashboardParallel_` (after `const enrolled = dashboardEnrolled_(scopedClasses);`) AND at the top of `computeDashboardSerial_` (same spot), add:

```js
  const requirements = parseProjectRequirements_(project);
```

In **all four** `aggregateStudent_(...)` calls inside those two functions (student rows + group rows in each), pass `requirements` as the 4th arg, e.g.:

```js
    const agg = aggregateStudent_(personalSources, personalHighlights, bundle, requirements);
```
```js
    const agg = aggregateStudent_(fetched.sources, fetched.highlights, bundle, requirements);
```
(and the two serial equivalents).

In **all four** returned row objects (student + group, parallel + serial), add after `completion: agg.completion,`:

```js
      sourcesProgress: agg.sourcesProgress,
      evidenceDepth:   agg.evidenceDepth,
```

- [ ] **Step 3: Add requirements to the dashboard cache key + response project**

In `consoleGetProjectDashboard`, change the `cacheKey` line (~253) to fold in a requirements fingerprint:

```js
  const reqFp = shortHash_(JSON.stringify(parseProjectRequirements_(project)));
  const cacheKey = 'dash:v1:' + projectId + ':' + scopedClasses.slice().sort().join(',') +
    (consoleSampleDataEnabled_() ? ':s1' : ':s0') + ':r' + reqFp;
```

In the `resp.project` object (~290-306), add after `activeClass: ...,`:

```js
      requirements: parseProjectRequirements_(project),
```

- [ ] **Step 4: Add requirements to `consoleGetMyProjects` entries**

In `consoleGetMyProjects`, in the `projects = visible.map(...)` return object, add after `status: p.status,`:

```js
      requirements: parseProjectRequirements_(p),
```

- [ ] **Step 5: Add requirements to the extension `projects` action**

In `apps-script/src/30_endpoints.js`, change the `projects` case (~131-132) to map parsed requirements onto each project:

```js
      case 'projects':
        return { ok: true, projects: listActiveProjectsForStudent_(actorEmail)
          .map((p) => Object.assign({}, p, { requirements: parseProjectRequirements_(p) })) };
```

- [ ] **Step 6: Add requirements to the Docs sidebar context + data**

In `apps-script/src/53_sidebar_api.js` `sidebarGetContext` return object, add after `activeBundle,`:

```js
    activeRequirements: parseProjectRequirements_(activeProject),
```

In `sidebarGetProjectData` (the full data dump), find where it resolves the project (`getProject_(projectId)`) and add `requirements: parseProjectRequirements_(project)` to its returned object. (Grep `sidebarGetProjectData` for the `return {` shape and add the key alongside `sources`/`highlights`.)

- [ ] **Step 7: Thread requirements into the two drill-down call sites**

`aggregateStudentDetail_` now takes a 5th `requirements` arg (Task 2). Update BOTH call sites in `apps-script/src/61_console_api.js` — `consoleGetStudentDetail` (~692) and the group drill-down (~1192) — to pass it (both have `project` in scope):

```js
  const aggregates = aggregateStudentDetail_(sources, highlights, bundle, project.createdAt, parseProjectRequirements_(project));
```

(The per-source evidence line in the drill-down UI reads `aggregates.evidenceDepth.perSource` matched by `sourceId` — Task 6 Step 5 — so the existing `completionFlags` block at ~677 does NOT need an `evidence` field added.)

- [ ] **Step 8: Verify nothing regressed**

Run `devTestDashboardParityParallelVsSerial` (or `devTestDashboardPerfAll`) in the editor. Expected: parallel == serial (both now include the new keys identically) — still all PASS. Run `devTestConsoleDashboardEndToEnd` — expect PASS.

- [ ] **Step 9: Commit**

```bash
git add apps-script/src/03_utils.js apps-script/src/61_console_api.js apps-script/src/30_endpoints.js apps-script/src/53_sidebar_api.js
git commit -m "feat(requirements): serve requirements through dashboard + console + extension + sidebar payloads"
```

---

## Task 5: Register tests in the suite runner

**Files:**
- Modify: `apps-script/src/99_dev.js`

- [ ] **Step 1: Add a one-shot runner for the new tests**

In `apps-script/src/99_dev.js`, add:

```js
/** Runs every requirements test in one shot; prints a single summary. */
function devTestRequirementsAll() {
  console.log('--- devTestProjectRequirementsParse ---');        devTestProjectRequirementsParse();
  console.log('--- devTestRequirementsValidation ---');          devTestRequirementsValidation();
  console.log('--- devTestCompletionRespectsAnnotationToggle ---'); devTestCompletionRespectsAnnotationToggle();
  console.log('--- devTestEvidenceDepth ---');                   devTestEvidenceDepth();
  console.log('--- devTestSourcesProgress ---');                 devTestSourcesProgress();
  console.log('--- devTestRequirementsBackCompat ---');          devTestRequirementsBackCompat();
  console.log('--- devTestConsoleUpdateRequirements (needs Dev Project) ---'); devTestConsoleUpdateRequirements();
}
```

- [ ] **Step 2: Run `devTestRequirementsAll` — expect every block all-PASS.**

- [ ] **Step 3: Commit**

```bash
git add apps-script/src/99_dev.js
git commit -m "test(requirements): devTestRequirementsAll suite runner"
```

---

## Task 6: Console UI — create fieldset, edit modal, dashboard pills, drill-down (DOM / QA)

**Files:**
- Modify: `apps-script/src/console_js.html` (create form ~446+, dashboard rows ~1589/1651, drill-down ~2110-2150)
- Modify: `apps-script/src/console_css.html` (pill/badge styles)

> No unit tests — verify by loading the console (Task 9 push first), creating a project with requirements, and reading the dashboard. Follow the existing brand tokens (CLAUDE.md §4 + `ops-brand-guidelines`): stoplight green/amber/red on **pills only**; blue/red/gray elsewhere.

- [ ] **Step 1: Add a `requirements` block to the create form's `fields`**

In `apps-script/src/console_js.html` `openCreateProjectModal_` (~391), extend the initial `fields`:

```js
  const fields = {
    name: '',
    schoolYear: defaultSchoolYear_(),
    bundleId: '',
    memberClasses: [],
    requirements: { minSources: '', minHighlightsPerSource: '', minDistinctCategories: '', requireAnnotation: true },
  };
```

- [ ] **Step 2: Render the "Requirements (optional)" fieldset**

In `renderCreateModal_`, after the Bundle field is appended to `body` (after the bundle authoring sub-form block, before the modal footer), append the reusable fieldset built by a new helper. Add this helper near `renderCreateModal_`:

```js
/**
 * Builds the optional-requirements fieldset bound to a `req` object
 * ({minSources, minHighlightsPerSource, minDistinctCategories, requireAnnotation}).
 * Shared by the create modal and the edit modal. Blank number input = unset.
 */
function buildRequirementsFields_(req) {
  const wrap = document.createElement('div');
  wrap.className = 'req-fieldset';
  const head = document.createElement('div');
  head.className = 'req-fieldset__head';
  head.textContent = 'Requirements (optional)';
  wrap.appendChild(head);

  const numField = (label, key, max) => {
    const f = makeField_(label, (() => {
      const i = document.createElement('input');
      i.type = 'number'; i.min = '1'; if (max) i.max = String(max);
      i.placeholder = 'no minimum';
      i.value = req[key] === '' || req[key] == null ? '' : String(req[key]);
      i.addEventListener('input', () => { req[key] = i.value; });
      return i;
    })());
    wrap.appendChild(f);
  };
  numField('Min sources', 'minSources');
  numField('Min highlights per source', 'minHighlightsPerSource');
  numField('Min distinct categories per source', 'minDistinctCategories', 5);

  // Annotations-required toggle (default on). Reuse the brand toggle styling.
  const tgl = makeField_('Annotations required', (() => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'req-toggle' + (req.requireAnnotation ? ' req-toggle--on' : '');
    btn.textContent = req.requireAnnotation ? 'Required' : 'Optional';
    btn.addEventListener('click', () => {
      req.requireAnnotation = !req.requireAnnotation;
      btn.className = 'req-toggle' + (req.requireAnnotation ? ' req-toggle--on' : '');
      btn.textContent = req.requireAnnotation ? 'Required' : 'Optional';
    });
    return btn;
  })());
  wrap.appendChild(tgl);
  return wrap;
}
```

Then in `renderCreateModal_` append it: `body.appendChild(buildRequirementsFields_(fields.requirements));`

(The existing submit path already sends `fields` to `.consoleCreateProject(fields)` at ~767 — `fields.requirements` rides along; the server validates it.)

- [ ] **Step 3: Add the styles**

In `apps-script/src/console_css.html`, add:

```css
.req-fieldset { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--c-border, #e0e0e0); }
.req-fieldset__head { font-weight: 600; font-size: 13px; color: var(--c-ink, #1d2a5d); margin-bottom: 6px; }
.req-toggle { padding: 6px 14px; border-radius: 999px; border: 1px solid var(--c-border, #ccc);
  background: #eceff4; color: #5f6368; font-weight: 600; cursor: pointer; }
.req-toggle--on { background: var(--c-primary, #2d3f89); border-color: var(--c-primary, #2d3f89); color: #fff; }
/* dashboard requirement indicators */
.db-srcprog { font-variant-numeric: tabular-nums; }
.db-srcprog--unmet { color: #ad2122; font-weight: 600; }
.db-srcprog--met { color: #0b8043; font-weight: 600; }
.db-depth-badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px;
  font-variant-numeric: tabular-nums; background: #eef1f8; color: #2d3f89; }
.db-evpill { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px; margin-left: 4px; }
.db-evpill--bad { background: #fce8e6; color: #c5221f; }
.db-evpill--good { background: #e6f4ea; color: #137333; }
```

- [ ] **Step 4: Dashboard row — sources progress + evidence badge, hide note pill when annotations off**

In the student row builder (~1620-1660) and group row builder (~1580-1600), where the sources count and gap pills are rendered:

1. Render sources progress: when `dashboard.data.project.requirements.minSources` is set, show `s.sourceCount + ' / ' + minSources` with class `db-srcprog db-srcprog--met|--unmet` based on `s.sourcesProgress.meets`; otherwise the plain `s.sourceCount` as today.
2. When `s.evidenceDepth.targetSet`, render a `db-depth-badge`: `s.evidenceDepth.sourcesMeeting + '/' + s.evidenceDepth.total + ' meet depth'`, plus an evidence pill `db-evpill--good|--bad`.
3. The note gap pill: render it only when `dashboard.data.project.requirements.requireAnnotation !== false`. (The dashboard response is stored module-level as `dashboard.data` in `fetchDashboard_` at line ~1121, so `dashboard.data.project.requirements` is the live requirements object — present because Task 4 added it to `resp.project`.)

Helper to add near the row builders:

```js
function buildSourcesProgressCell_(s, requirements) {
  const span = document.createElement('span');
  if (requirements && requirements.minSources) {
    span.className = 'db-srcprog ' + (s.sourcesProgress && s.sourcesProgress.meets ? 'db-srcprog--met' : 'db-srcprog--unmet');
    span.textContent = (s.sourceCount || 0) + ' / ' + requirements.minSources;
  } else {
    span.className = 'db-srcprog';
    span.textContent = String(s.sourceCount || 0);
  }
  return span;
}
function buildDepthBadge_(s) {
  if (!s.evidenceDepth || !s.evidenceDepth.targetSet) return null;
  const b = document.createElement('span');
  const allMet = s.evidenceDepth.sourcesMeeting === s.evidenceDepth.total && s.evidenceDepth.total > 0;
  b.className = 'db-depth-badge';
  b.textContent = s.evidenceDepth.sourcesMeeting + '/' + s.evidenceDepth.total + ' meet depth';
  const pill = document.createElement('span');
  pill.className = 'db-evpill ' + (allMet ? 'db-evpill--good' : 'db-evpill--bad');
  pill.textContent = allMet ? 'depth ✓' : 'depth';
  const frag = document.createDocumentFragment();
  frag.appendChild(b); frag.appendChild(pill);
  return frag;
}
```

Wire `buildSourcesProgressCell_(s, reqs)` into the sources cell and `buildDepthBadge_(s)` (append if non-null) into the row; pass `reqs = dashboard.data.project.requirements`. Gate the existing Note gap pill on `reqs.requireAnnotation !== false`.

- [ ] **Step 5: Drill-down — per-source evidence line; flag chips respect requireAnnotation**

In the drill-down source card builder (~2110-2150), where `makeFlagChip_('Note', ...)` is appended (line ~2132): only append the Note chip when `d.aggregates.requireAnnotation !== false`.

Add a per-source evidence line using `d.aggregates.evidenceDepth.perSource` (match by `sourceId`):

```js
function buildEvidenceLine_(sourceId, depth) {
  if (!depth || !depth.targetSet) return null;
  const ps = (depth.perSource || []).find((p) => p.sourceId === sourceId);
  if (!ps) return null;
  const line = document.createElement('div');
  line.className = 'dd-source-card__evidence' + (ps.meets ? ' is-met' : '');
  const bits = [];
  if (depth.minHighlightsPerSource) bits.push(ps.highlightCount + '/' + depth.minHighlightsPerSource + ' highlights');
  if (depth.minDistinctCategories)  bits.push(ps.distinctCategoryCount + '/' + depth.minDistinctCategories + ' categories');
  line.textContent = bits.join(' · ') + (ps.meets ? ' ✓' : '');
  return line;
}
```

Append `buildEvidenceLine_(s.sourceId, d.aggregates.evidenceDepth)` (if non-null) into each source card. Add a style:

```css
.dd-source-card__evidence { font-size: 12px; color: #5f6368; margin-top: 4px; }
.dd-source-card__evidence.is-met { color: #137333; }
```

- [ ] **Step 6: Edit-requirements modal**

Add an "Edit requirements" button to the project dashboard header (near the `db-refresh` button, built in `renderDashboard_` ~1032). On click, open a modal reusing `buildRequirementsFields_` seeded from `dashboard.data.project.requirements` (coerce nulls to `''` for the inputs), and on Save call:

```js
const projectId = dashboard.data.project.projectId;
google.script.run
  .withSuccessHandler(() => { setStatus('Requirements updated', 'good', 2000); closeModal_(); fetchDashboard_(projectId, true); })
  .withFailureHandler(onFail_('updating requirements'))
  .consoleUpdateProjectRequirements(projectId, editReq);
```

`fetchDashboard_(projectId, true)` re-fetches with the cache-bypass flag (line ~1133), so the edited requirements show immediately.

- [ ] **Step 7: QA + commit**

Load the console (after Task 9 pushes), create a project with min sources 5 / min highlights 3 / min categories 2 / annotations optional, confirm the dashboard shows `N / 5`, a depth badge, no Note pill; open a drill-down and confirm per-source evidence lines. Then:

```bash
git add apps-script/src/console_js.html apps-script/src/console_css.html
git commit -m "feat(requirements): console create fieldset, edit modal, dashboard pills + drill-down evidence"
```

---

## Task 7: Student-facing nudges — in-page sidebar + Docs sidebar (DOM / QA)

**Files:**
- Modify: `extension/content/sidebar.js` (per-source nudges)
- Modify: `apps-script/src/sidebar_js.html` (overall progress + per-source depth recap)

> No unit tests — real-page QA. The in-page sidebar already carries `state.project` (now with `.requirements`) and the page's highlights; the Docs sidebar gets `requirements` from `sidebarGetProjectData`/`sidebarGetContext` (Task 4).

- [ ] **Step 1: In-page sidebar — Source-tab annotation label + depth hint**

In `extension/content/sidebar.js` `renderSourceTab_` (~993), read `const req = (state.project && state.project.requirements) || {};`. Where the annotation field is rendered, label it "Annotation (required)" vs "Annotation (optional)" from `req.requireAnnotation !== false`. Below the source's category controls, if `req.minHighlightsPerSource` or `req.minDistinctCategories` is set, compute the current source's highlight count + distinct primary categories from the sidebar's loaded highlights (the same array the Annotations tab + `countByCategory_` use) and render a hint line, e.g. `needs 1 more highlight` / `needs 1 more category` / `meets this project's evidence target ✓`. Use existing class conventions (e.g. a new `.src__hint`).

```js
function evidenceHint_(highlightsForSource, req) {
  if (!req || (!req.minHighlightsPerSource && !req.minDistinctCategories)) return null;
  const count = highlightsForSource.length;
  const cats = {};
  highlightsForSource.forEach((h) => { if (h.primaryCategory) cats[h.primaryCategory] = true; });
  const distinct = Object.keys(cats).length;
  const needH = req.minHighlightsPerSource ? Math.max(0, req.minHighlightsPerSource - count) : 0;
  const needC = req.minDistinctCategories ? Math.max(0, req.minDistinctCategories - distinct) : 0;
  if (needH === 0 && needC === 0) return 'Meets this project’s evidence target ✓';
  const parts = [];
  if (needH > 0) parts.push(needH + ' more highlight' + (needH > 1 ? 's' : ''));
  if (needC > 0) parts.push(needC + ' more categor' + (needC > 1 ? 'ies' : 'y'));
  return 'Needs ' + parts.join(' and ');
}
```

Wire the returned string into a small element on the Source tab (and/or the Annotations tab header). Grep the file for the array of the current page source's highlights to pass in.

- [ ] **Step 2: Docs sidebar — overall sources progress + per-source depth**

In `apps-script/src/sidebar_js.html`, where the project's sources are listed (after `sidebarGetProjectData` returns), read `data.requirements`. Render at the top of the source list an overall "Sources: X / N" line when `requirements.minSources` is set (X = number of sources for the caller). For each source, when a depth target is set, show a small "k/min highlights · j/min categories" recap computed from that source's highlights (already grouped in the sidebar). Keep it lightweight; brand tokens per `sidebar_css.html`.

- [ ] **Step 3: QA + commit**

Reload the extension; on a page with a saved source, confirm the Source tab shows the annotation required/optional label + the evidence hint shrinking as you highlight. In a Doc, open the research panel and confirm the sources-progress line + per-source depth recap. Then:

```bash
git add extension/content/sidebar.js apps-script/src/sidebar_js.html
git commit -m "feat(requirements): student nudges — in-page sidebar hints + Docs sidebar progress"
```

(Per CLAUDE.md §13: the extension is a thin client served from `extension/`; for the pilot it's loaded unpacked, so no version bump is needed unless publishing to the Web Store — note this in the PR if relevant.)

---

## Task 8: Docs — fix stale note + record the feature

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Fix the stale `sidebar-refresh` claim**

In `CLAUDE.md` §3 (Phase 2) and §4, the in-page sidebar is described as "code-complete on branch `sidebar-refresh` … not yet merged to main." That work is on `main` (verified: `extension/content/sidebar.js` has the Source/Annotations tabs, facets, and toast; backend `previewCitation` + `doPost` `kind:'source'` are on `main`). Update those passages to say it's merged/live on `main`.

- [ ] **Step 2: Record the requirements feature**

Add a §4 decision bullet summarizing: optional per-project `requirements` JSON column (`minSources` / `minHighlightsPerSource` / `minDistinctCategories` / `requireAnnotation`, defaults preserve today); soft + nudges (no bibliography/save-path change); the pure aggregator readings (annotation-conditional completion, evidence depth, sources progress); `consoleUpdateProjectRequirements` for post-hoc edits; `devTestRequirementsAll` covers it; `migrateAddRequirements_` heals the registry header. Add the new `devTest*` names to §8.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record project-requirements feature; fix stale sidebar-refresh note"
```

---

## Task 9: Push, migrate, redeploy, verify

**Files:** none (deploy + verification)

- [ ] **Step 1: Push Apps Script**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\Users\paul.ivers\Desktop\ops-research-tool\apps-script
clasp push -f
```

- [ ] **Step 2: Run the migration + full test suite in the editor**

`clasp open`, then run: `migrateAddRequirements_`, `devTestRequirementsAll`, `devTestDashboardPerfAll`, `devTestRoundTrip`, `devTestGroupsAll`. Expected: all green; the requirements suite prints all-PASS per block.

- [ ] **Step 3: Redeploy the Web App**

Per CLAUDE.md §11, the push to `main` triggers CI redeploy (if `GAS_DEPLOYMENT_ID` is set); otherwise redeploy via the editor (Deploy ▸ Manage deployments ▸ edit ▸ new version) or the Actions tab. Confirm the active deployment is on the new version.

- [ ] **Step 4: Smoke-test live**

Load the console: create a project with requirements, verify dashboard `N / target` + depth badge + drill-down evidence + edit-requirements modal. Load the extension on a real page and confirm the Source-tab hint.

- [ ] **Step 5: Final commit / branch is ready for PR**

```bash
cd C:\Users\paul.ivers\Desktop\ops-research-tool
git push -u origin feat/project-requirements
```

Then use `superpowers:finishing-a-development-branch` to open the PR.

---

## Self-Review Notes (for the executor)

- **Spec coverage:** the four settings (Task 1/3), two-track metric (Task 2), set-at-creation + edit-later (Task 3), dashboard + drill-down (Task 6), both student surfaces (Task 7), back-compat lock (Task 2 `devTestRequirementsBackCompat`), CLAUDE.md fix (Task 8) — all mapped.
- **Type consistency:** the aggregate keys `sourcesProgress {minSources, sourceCount, meets}` and `evidenceDepth {targetSet, total, sourcesMeeting, minHighlightsPerSource, minDistinctCategories, perSource?}` are used identically in the aggregator (Task 2), the dashboard rows + payloads (Task 4), and the UI (Tasks 6/7). `requirements {minSources, minHighlightsPerSource, minDistinctCategories, requireAnnotation}` is the normalized shape from `parseProjectRequirements_` everywhere; the raw form input (with blank strings) only exists in the console form + `validateRequirementsInput_`.
- **Shadowing:** every new `*_` helper name (`parseProjectRequirements_`, `computeEvidenceDepth_`, `computeSourcesProgress_`, `validateRequirementsInput_`, `migrateAddRequirements_`, `shortHash_`) must be grepped across `apps-script/src` before adding — single definition only (CLAUDE.md §5).
