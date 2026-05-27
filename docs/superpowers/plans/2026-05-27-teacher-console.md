# Teacher Console — Foundation + My Projects + Project Dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the OPS Research Tool Teacher Console — a Staff-gated, OPS-branded GAS web app with three screens (My Projects, Project Dashboard, Student Drill-down) that lets teachers create/archive projects and monitor student research progress with a visual heat-map table and per-student charts.

**Architecture:** Single GAS web app, same deployment as the existing extension/sidebar. `doGet` adds a no-action branch that serves the console HTML; existing `?action=` JSON dispatcher untouched. Client is vanilla JS with a 3-state machine, URL hash routing, and Chart.js 4.x via CDN. Per-student dashboard aggregates are computed server-side in a pure-function aggregator module.

**Tech Stack:** Apps Script V8 runtime · Google Workspace Sheets storage · HtmlService templates · vanilla JS in HTML files (no bundler) · `google.script.run` for client→server · Chart.js 4.x via CDN.

**Repo:** `C:\dev\ops-research-tool` (Windows, PowerShell default; bash also available)
**GAS push command** (refresh PATH first per `CLAUDE.md` §8): `cd C:\dev\ops-research-tool\apps-script; clasp push -f`
**Project ID:** `1IFhm0FJNiXSeDKGS8VnDfkhs8VY6ueWmHIvc6CIda1AcFXrh1skow2E3`
**Spec:** `docs/superpowers/specs/2026-05-27-teacher-console-design.md`

---

## File Structure (final state)

After this plan completes:

```
apps-script/src/
  30_endpoints.js           ← MODIFIED: doGet adds no-action branch
  60_console_routing.js     ← NEW: serveConsoleHtml_
  61_console_api.js         ← NEW: console* endpoints
  62_aggregator.js          ← NEW: pure aggregator functions
  console.html              ← NEW: shell template
  console_css.html          ← NEW: OPS-branded styles
  console_js.html           ← NEW: vanilla JS app
  99_dev.js                 ← MODIFIED: +5 devTest* functions
```

No changes to: `01_setup.js`, `02_constants.js`, `03_utils.js`, `04_user_prefs.js`, `10_identity.js`, `11_provisioning.js`, `12_projects.js`, `13_bundles.js`, `20_writes.js`, `21_reads.js`, `40_seed_history_day.js`, `50_docs_addon.js`, `51_citation.js`, `52_bibliography.js`, `53_sidebar_api.js`, `sidebar.html`, `sidebar_js.html`, `sidebar_css.html`, `source_editor.html`, `source_editor_js.html`, `extension/**`. The console is additive.

---

## Pre-flight (do once)

- [ ] **P1: Confirm clean working tree and starting commit**

```powershell
cd C:\dev\ops-research-tool
git status
git log -1 --oneline
```

Expected: working tree clean, on `main` (head should be `04794e4` — the spec commit — or later).

- [ ] **P2: Create feature branch**

```powershell
cd C:\dev\ops-research-tool
git checkout -b feature/teacher-console
```

Expected: switched to a new branch.

- [ ] **P3: Confirm clasp works**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\dev\ops-research-tool\apps-script
clasp status
```

Expected: prints `Cloning files...` then a list including `src/30_endpoints.js`, `src/99_dev.js`, etc.

- [ ] **P4: Confirm existing dev tests pass**

In the GAS editor (https://script.google.com/d/1IFhm0FJNiXSeDKGS8VnDfkhs8VY6ueWmHIvc6CIda1AcFXrh1skow2E3/edit):
- Run `devTestNormalizeUrl` → expect `8/8 passed`.
- Run `devTestRoundTrip` → expect no errors.
- Run `devTestDeleteSource` → expect `9/9 passed`.

Do not proceed if any fails.

---

## Task 1: Aggregator pure functions + dev test

**Files:**
- Create: `apps-script/src/62_aggregator.js`
- Modify: `apps-script/src/99_dev.js` (append `devTestAggregateStudent`)

Pure functions only. No Sheet access. Easy to test via editor-callable function.

- [ ] **Step 1: Create `apps-script/src/62_aggregator.js`**

```javascript
/**
 * Pure aggregation functions for the Teacher Console.
 *
 * Inputs: raw rows from per-student Sheets (sources, highlights) plus the
 * project's bundle. Outputs: the shapes the Console renders.
 *
 * No Sheet access in this file — separation makes everything trivially
 * unit-testable via editor-callable devTest* functions in 99_dev.js.
 */

/**
 * One dashboard-row's worth of aggregates for a single student.
 *
 *   aggregateStudent_(sources, highlights, bundle)
 *     → { categoryMix, sourceCount, highlightCount, completion, gaps, lastActivity }
 *
 * `categoryMix` preserves bundle order so the dashboard stack-bar always
 * paints categories in the same slot regardless of insertion order.
 */
function aggregateStudent_(sources, highlights, bundle) {
  return {
    categoryMix: formatBundleCategoryMix_(highlights, bundle),
    sourceCount: sources.length,
    highlightCount: highlights.length,
    completion: computeCompletionSummary_(sources),
    gaps: computeGaps_(sources),
    lastActivity: computeLastActivity_(sources, highlights),
  };
}

/**
 * Drill-down aggregates — richer than dashboard, includes activity-by-day.
 */
function aggregateStudentDetail_(sources, highlights, bundle, projectCreatedAt) {
  return {
    categoryMix: formatBundleCategoryMix_(highlights, bundle),
    sourceCounts: computeSourceCounts_(sources),
    completion: computeCompletion_(sources),
    activityByDay: computeActivityByDay_(sources, highlights, projectCreatedAt),
  };
}

/**
 * Ordered [{label, count, color}] matching bundle.label1..label5 /
 * color1..color5. Categories with zero highlights still appear with count=0
 * so the stack-bar segment renders gray-hatched instead of being missing.
 */
function formatBundleCategoryMix_(highlights, bundle) {
  const counts = {};
  highlights.forEach((h) => {
    if (h.primaryCategory) counts[h.primaryCategory] = (counts[h.primaryCategory] || 0) + 1;
  });
  const out = [];
  if (!bundle) return out;
  for (let i = 1; i <= 5; i++) {
    const label = bundle['label' + i];
    if (!label) continue;
    out.push({ label, color: bundle['color' + i] || '#dadce0', count: counts[label] || 0 });
  }
  return out;
}

/** {primary, secondary, unset} counts. */
function computeSourceCounts_(sources) {
  const out = { primary: 0, secondary: 0, unset: 0 };
  sources.forEach((s) => {
    const ps = s.primarySecondary || 'unset';
    if (out[ps] !== undefined) out[ps]++;
    else out.unset++;
  });
  return out;
}

/**
 * Per-field completion:
 *   citation:       title AND url non-empty in citationFields (parsed JSON)
 *   classification: primarySecondary !== 'unset'
 *   annotation:     trimmed annotation length > 0
 *
 * Returns { citation: {complete, total}, classification: {...}, annotation: {...} }
 */
function computeCompletion_(sources) {
  let citation = 0, classification = 0, annotation = 0;
  sources.forEach((s) => {
    const parsed = parseCitationFields_(s);
    if (parsed.title && parsed.url) citation++;
    if (s.primarySecondary && s.primarySecondary !== 'unset') classification++;
    if (s.annotation && String(s.annotation).trim().length > 0) annotation++;
  });
  const total = sources.length;
  return {
    citation:       { complete: citation,       total },
    classification: { complete: classification, total },
    annotation:     { complete: annotation,     total },
  };
}

/**
 * Headline completion for the dashboard row:
 *   percent = sources where ALL of (citation complete, classification set,
 *             annotation non-empty) / total. Zero sources → 0%.
 */
function computeCompletionSummary_(sources) {
  if (sources.length === 0) return { percent: 0, complete: 0, total: 0 };
  let complete = 0;
  sources.forEach((s) => {
    const parsed = parseCitationFields_(s);
    const citationOk = parsed.title && parsed.url;
    const classOk = s.primarySecondary && s.primarySecondary !== 'unset';
    const annOk = s.annotation && String(s.annotation).trim().length > 0;
    if (citationOk && classOk && annOk) complete++;
  });
  return {
    percent: Math.round((complete / sources.length) * 100),
    complete,
    total: sources.length,
  };
}

/** Per-field gap counts (number of sources missing each field). */
function computeGaps_(sources) {
  let cit = 0, cls = 0, ann = 0;
  sources.forEach((s) => {
    const parsed = parseCitationFields_(s);
    if (!(parsed.title && parsed.url)) cit++;
    if (!s.primarySecondary || s.primarySecondary === 'unset') cls++;
    if (!s.annotation || String(s.annotation).trim().length === 0) ann++;
  });
  return { citation: cit, classification: cls, annotation: ann };
}

/** Latest ISO timestamp from sources + highlights. Null if both empty. */
function computeLastActivity_(sources, highlights) {
  let latest = null;
  const consider = (iso) => {
    if (!iso) return;
    if (latest === null || iso > latest) latest = iso;
  };
  sources.forEach((s) => consider(s.createdAt));
  highlights.forEach((h) => consider(h.createdAt));
  return latest;
}

/**
 * Daily-binned counts of sources + highlights from projectCreatedAt (or the
 * earliest activity, whichever is earlier) up to today.
 * Returns [{ date: 'YYYY-MM-DD', sources: N, highlights: N }, ...] in
 * chronological order. Empty days are included with zeros so the line
 * chart has no gaps.
 */
function computeActivityByDay_(sources, highlights, projectCreatedAt) {
  const dayKey = (iso) => String(iso).slice(0, 10);
  const counts = {}; // 'YYYY-MM-DD' → {sources, highlights}
  const bump = (iso, key) => {
    if (!iso) return;
    const d = dayKey(iso);
    if (!counts[d]) counts[d] = { sources: 0, highlights: 0 };
    counts[d][key]++;
  };
  sources.forEach((s) => bump(s.createdAt, 'sources'));
  highlights.forEach((h) => bump(h.createdAt, 'highlights'));

  // Range: earliest of (projectCreatedAt, observed data) to today.
  const observedKeys = Object.keys(counts);
  let startKey = projectCreatedAt ? dayKey(projectCreatedAt) : null;
  observedKeys.forEach((k) => {
    if (startKey === null || k < startKey) startKey = k;
  });
  if (!startKey) return [];
  const todayKey = dayKey(new Date().toISOString());

  const out = [];
  let cursor = new Date(startKey + 'T00:00:00Z');
  const stop = new Date(todayKey + 'T00:00:00Z');
  while (cursor.getTime() <= stop.getTime()) {
    const k = cursor.toISOString().slice(0, 10);
    const c = counts[k] || { sources: 0, highlights: 0 };
    out.push({ date: k, sources: c.sources, highlights: c.highlights });
    cursor = new Date(cursor.getTime() + 24 * 3600 * 1000);
  }
  return out;
}

/**
 * Parse `citationFields` (a JSON string column) to an object. Safe on null,
 * malformed JSON, and non-string types. Mirrors the parser in 52_bibliography.js
 * but kept local so 62 has no dependencies on other modules.
 */
function parseCitationFields_(source) {
  if (!source.citationFields) return {};
  try {
    const parsed = JSON.parse(source.citationFields);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}
```

- [ ] **Step 2: Append `devTestAggregateStudent` to `apps-script/src/99_dev.js`**

Open `apps-script/src/99_dev.js` and append:

```javascript
/**
 * Tests aggregator pure functions with hand-crafted source/highlight data.
 * Asserts categoryMix preserves bundle order, gaps + completion counts are
 * correct, and lastActivity is the latest createdAt across both arrays.
 */
function devTestAggregateStudent() {
  const bundle = {
    bundleId: 'b-test',
    name: 'Test Bundle',
    style: 'mla',
    label1: 'Background',     color1: '#d62728',
    label2: 'Build-Up',       color2: '#ff7f0e',
    label3: 'Main Event',     color3: '#2ca02c',
    label4: 'Short-Term Impact', color4: '#1f77b4',
    label5: 'Long-Term Impact',  color5: '#9467bd',
  };
  const sources = [
    {
      sourceId: 's1', primarySecondary: 'primary', annotation: 'Good source.',
      citationFields: JSON.stringify({ title: 'A', url: 'https://a' }),
      createdAt: '2026-05-20T10:00:00Z',
    },
    {
      sourceId: 's2', primarySecondary: 'secondary', annotation: '',
      citationFields: JSON.stringify({ title: 'B', url: 'https://b' }),
      createdAt: '2026-05-21T10:00:00Z',
    },
    {
      sourceId: 's3', primarySecondary: 'unset', annotation: 'Notes.',
      citationFields: JSON.stringify({ title: '', url: '' }),
      createdAt: '2026-05-22T10:00:00Z',
    },
  ];
  const highlights = [
    { sourceId: 's1', primaryCategory: 'Background',   createdAt: '2026-05-20T11:00:00Z' },
    { sourceId: 's1', primaryCategory: 'Background',   createdAt: '2026-05-20T11:05:00Z' },
    { sourceId: 's2', primaryCategory: 'Main Event',   createdAt: '2026-05-21T11:00:00Z' },
    { sourceId: 's3', primaryCategory: 'Background',   createdAt: '2026-05-23T08:00:00Z' },
    { sourceId: 's3', primaryCategory: 'Long-Term Impact', createdAt: '2026-05-23T08:30:00Z' },
  ];

  const agg = aggregateStudent_(sources, highlights, bundle);

  let pass = 0, fail = 0;
  const check = (label, cond) => {
    if (cond) { pass++; console.log('PASS ' + label); }
    else      { fail++; console.log('FAIL ' + label); }
  };

  // categoryMix preserves bundle order
  check('mix length 5',                     agg.categoryMix.length === 5);
  check('mix[0] is Background',             agg.categoryMix[0].label === 'Background');
  check('mix[0] count = 3',                 agg.categoryMix[0].count === 3);
  check('mix[1] is Build-Up, count 0',      agg.categoryMix[1].label === 'Build-Up' && agg.categoryMix[1].count === 0);
  check('mix[2] is Main Event, count 1',    agg.categoryMix[2].label === 'Main Event' && agg.categoryMix[2].count === 1);
  check('mix[4] is Long-Term Impact, ct 1', agg.categoryMix[4].label === 'Long-Term Impact' && agg.categoryMix[4].count === 1);

  // counts
  check('sourceCount = 3',                  agg.sourceCount === 3);
  check('highlightCount = 5',               agg.highlightCount === 5);

  // completion: only s1 has all three (citation+class+annotation). s2 missing annotation. s3 missing citation+classification.
  check('completion.complete = 1',          agg.completion.complete === 1);
  check('completion.total = 3',             agg.completion.total === 3);
  check('completion.percent = 33',          agg.completion.percent === 33);

  // gaps: citation missing on s3 only (s1, s2 have title+url) → 1
  //       classification missing on s3 only → 1
  //       annotation missing on s2 only (empty string) → 1
  check('gaps.citation = 1',                agg.gaps.citation === 1);
  check('gaps.classification = 1',          agg.gaps.classification === 1);
  check('gaps.annotation = 1',              agg.gaps.annotation === 1);

  // lastActivity = latest of any createdAt across sources+highlights
  check('lastActivity = 2026-05-23T08:30:00Z', agg.lastActivity === '2026-05-23T08:30:00Z');

  console.log(pass + '/' + (pass + fail) + ' passed');
}
```

- [ ] **Step 3: Push and run the test**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

In the GAS editor (reload), run `devTestAggregateStudent`. Expected: `15/15 passed`.

- [ ] **Step 4: Run existing dev tests for regression**

In the GAS editor, run `devTestNormalizeUrl` (expect `8/8`), `devTestRoundTrip` (no errors), `devTestDeleteSource` (expect `9/9`).

- [ ] **Step 5: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/62_aggregator.js apps-script/src/99_dev.js
git commit -m "feat(console): aggregator pure functions + dev test"
```

---

## Task 2: `consoleGetContext` endpoint + auth helper

**Files:**
- Create: `apps-script/src/61_console_api.js`
- Modify: `apps-script/src/99_dev.js` (append `devTestConsoleAuth`)

- [ ] **Step 1: Create `apps-script/src/61_console_api.js`**

```javascript
/**
 * Teacher Console endpoints — called from the Console HTML via
 * google.script.run. All endpoints share the same auth pattern:
 *
 *   const actorEmail = getActorEmail_();
 *   const staff = assertStaff_(actorEmail);   // throws 'Not authorized' if null
 *
 * Identity comes from the GAS session. Clients cannot spoof; non-staff
 * users hitting the URL or crafting manual google.script.run calls are
 * rejected at the server.
 */

/**
 * Bootstrap data: caller identity + staff entry + role + classes the
 * caller teaches. The Console JS gates the UI on `staff === null`.
 */
function consoleGetContext() {
  const actorEmail = getActorEmail_();
  const staff = getStaffEntry_(actorEmail);
  if (!staff) {
    return { ok: true, actor: actorEmail, staff: null, role: null, teacherClasses: [] };
  }
  const role = staff.Role === ROLES.ADMIN ? 'admin' : 'teacher';
  const teacherClasses = role === 'admin' ? null : listClassesTaughtBy_(actorEmail);
  return { ok: true, actor: actorEmail, staff, role, teacherClasses };
}

/**
 * Classes whose Teacher column equals this email in the Roster.
 * Distinct, trimmed, non-empty. Returns [] if the actor teaches nothing.
 */
function listClassesTaughtBy_(actorEmail) {
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const rows = readAllAsObjects_(getTab_(ss, TABS.ROSTER), HEADERS.ROSTER);
  const set = {};
  rows.forEach((r) => {
    if (r.Teacher && String(r.Teacher).trim().toLowerCase() === actorEmail.toLowerCase()) {
      const cls = String(r.Class || '').trim();
      if (cls) set[cls] = true;
    }
  });
  return Object.keys(set).sort();
}

/**
 * Throws 'Not authorized' if the caller isn't on the Staff sheet. Returns
 * the staff entry so callers can read .Role without re-fetching.
 */
function assertStaff_(actorEmail) {
  const staff = getStaffEntry_(actorEmail);
  if (!staff) throw new Error('Not authorized');
  return staff;
}

/** Convenience: true iff the staff entry's Role is admin. */
function isAdmin_(staff) {
  return staff && staff.Role === ROLES.ADMIN;
}
```

- [ ] **Step 2: Append `devTestConsoleAuth` to `apps-script/src/99_dev.js`**

```javascript
/**
 * Tests consoleGetContext + assertStaff_ behavior.
 * Note: this test uses the caller's real identity. The dev-seed harness
 * adds the caller to the Staff sheet as admin, so the "is staff" branch
 * is what we can directly assert. We assert the structural shape too.
 */
function devTestConsoleAuth() {
  devSeedDevProject();   // ensures caller is staff + admin
  const ctx = consoleGetContext();

  let pass = 0, fail = 0;
  const check = (label, cond) => {
    if (cond) { pass++; console.log('PASS ' + label); }
    else      { fail++; console.log('FAIL ' + label); }
  };

  check('ctx.ok',                       ctx && ctx.ok === true);
  check('actor is the caller email',    ctx.actor === Session.getEffectiveUser().getEmail());
  check('staff entry present',          !!ctx.staff);
  check('role is admin',                ctx.role === 'admin');
  check('teacherClasses is null (admin)', ctx.teacherClasses === null);

  // assertStaff_ for the caller should NOT throw.
  let throwsForStaff = false;
  try { assertStaff_(ctx.actor); } catch (e) { throwsForStaff = true; }
  check('assertStaff_ does not throw for staff', !throwsForStaff);

  // assertStaff_ for a definitely-not-staff email SHOULD throw.
  let throwsForRando = false;
  try { assertStaff_('definitely-not-staff@example.com'); } catch (e) { throwsForRando = true; }
  check('assertStaff_ throws for non-staff', throwsForRando);

  console.log(pass + '/' + (pass + fail) + ' passed');
}
```

- [ ] **Step 3: Push and run**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

In GAS editor, run `devTestConsoleAuth`. Expected: `7/7 passed`.

- [ ] **Step 4: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/61_console_api.js apps-script/src/99_dev.js
git commit -m "feat(console): consoleGetContext + auth helpers + dev test"
```

---

## Task 3: `consoleGetMyProjects` + role filter

**Files:**
- Modify: `apps-script/src/61_console_api.js` (append endpoint)
- Modify: `apps-script/src/99_dev.js` (append `devTestConsoleProjectsFilter`)

- [ ] **Step 1: Append endpoint to `apps-script/src/61_console_api.js`**

```javascript
/**
 * Projects the caller has access to. Teachers see projects whose
 * memberClasses intersect classes they teach; admins see all.
 *
 * filter: 'active' (default) or 'archived'.
 *
 * Per spec §6: the project list is read-light. No per-student-sheet opens
 * happen here. Each card's studentCount is computed from the Roster
 * (rows whose Class ∈ memberClasses ∩ teacherClasses).
 */
function consoleGetMyProjects(filter) {
  const actorEmail = getActorEmail_();
  const staff = assertStaff_(actorEmail);
  const wantStatus = (filter === 'archived') ? PROJECT_STATUS.ARCHIVED : PROJECT_STATUS.ACTIVE;

  const all = listProjects_();
  const bundles = listBundles_();
  const bundleById = {};
  bundles.forEach((b) => { bundleById[b.bundleId] = b; });

  const teacherClasses = isAdmin_(staff) ? null : listClassesTaughtBy_(actorEmail);

  const rosterRows = readAllAsObjects_(
    getTab_(SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID), TABS.ROSTER),
    HEADERS.ROSTER
  );

  const visible = all.filter((p) => {
    if (p.status !== wantStatus) return false;
    if (isAdmin_(staff)) return true;
    const projectClasses = projectClassList_(p);
    return projectClasses.some((c) => teacherClasses.indexOf(c) >= 0);
  });

  const projects = visible.map((p) => {
    const projectClasses = projectClassList_(p);
    const scopedClasses = isAdmin_(staff)
      ? projectClasses
      : projectClasses.filter((c) => teacherClasses.indexOf(c) >= 0);
    const studentCount = rosterRows.filter(
      (r) => r.Class && scopedClasses.indexOf(String(r.Class).trim()) >= 0
    ).length;
    const bundle = bundleById[p.bundleId] || null;
    return {
      projectId: p.projectId,
      name: p.name,
      schoolYear: p.schoolYear,
      bundleId: p.bundleId,
      bundleName: bundle ? bundle.name : '(unknown bundle)',
      memberClasses: projectClasses,
      scopedClasses,         // classes the caller actually sees
      studentCount,
      status: p.status,
    };
  });

  // Sort: schoolYear desc, then name asc.
  projects.sort((a, b) => {
    if (a.schoolYear !== b.schoolYear) return a.schoolYear > b.schoolYear ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { ok: true, projects };
}

/** Parse a project's comma-separated memberClasses into a trimmed string array. */
function projectClassList_(project) {
  return String(project.memberClasses || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
```

- [ ] **Step 2: Append `devTestConsoleProjectsFilter` to `apps-script/src/99_dev.js`**

```javascript
/**
 * Tests role-based project filtering in consoleGetMyProjects.
 *
 * The caller is always admin (per devSeedDevProject), so we can directly
 * exercise the admin branch and the teacher branch via a temporary
 * roster manipulation: temporarily remove the caller from the Staff
 * sheet and check that consoleGetMyProjects throws.
 */
function devTestConsoleProjectsFilter() {
  devSeedDevProject();
  const me = Session.getEffectiveUser().getEmail();

  let pass = 0, fail = 0;
  const check = (label, cond) => {
    if (cond) { pass++; console.log('PASS ' + label); }
    else      { fail++; console.log('FAIL ' + label); }
  };

  // Admin sees Dev Project in the active filter.
  const adminResp = consoleGetMyProjects('active');
  check('admin: resp.ok',          adminResp && adminResp.ok === true);
  check('admin: ≥1 project',       adminResp.projects.length >= 1);
  const dev = adminResp.projects.find((p) => p.name === 'Dev Project');
  check('admin: Dev Project visible', !!dev);
  if (dev) {
    check('admin: scopedClasses includes DEV', dev.scopedClasses.indexOf('DEV') >= 0);
    check('admin: studentCount ≥1',            dev.studentCount >= 1);
    check('admin: bundleName non-empty',       !!dev.bundleName);
  }

  // Archived filter — Dev Project is active, so it should NOT appear.
  const arch = consoleGetMyProjects('archived');
  check('archived: resp.ok',                 arch && arch.ok === true);
  const devInArchived = arch.projects.find((p) => p.name === 'Dev Project');
  check('archived: Dev Project NOT visible', !devInArchived);

  // Non-staff lockout — temporarily remove the caller from Staff and re-test.
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const staffTab = getTab_(ss, TABS.STAFF);
  const rowIdx = findRowByKey_(staffTab, HEADERS.STAFF, 'Email', me);
  let removedRow = null;
  if (rowIdx >= 0) {
    removedRow = staffTab.getRange(rowIdx, 1, 1, HEADERS.STAFF.length).getValues()[0];
    staffTab.deleteRow(rowIdx);
  }
  let throws = false;
  try { consoleGetMyProjects('active'); } catch (e) { throws = true; }
  check('non-staff: endpoint throws', throws);

  // Restore the staff row.
  if (removedRow) {
    appendRow_(staffTab, HEADERS.STAFF, rowToObj_(HEADERS.STAFF, removedRow));
  }

  console.log(pass + '/' + (pass + fail) + ' passed');
}
```

- [ ] **Step 3: Push and run**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

In GAS editor, run `devTestConsoleProjectsFilter`. Expected: `9/9 passed`.

- [ ] **Step 4: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/61_console_api.js apps-script/src/99_dev.js
git commit -m "feat(console): consoleGetMyProjects with role-based filtering"
```

---

## Task 4: Create / Archive / Unarchive endpoints

**Files:**
- Modify: `apps-script/src/61_console_api.js` (append three endpoints)
- Modify: `apps-script/src/99_dev.js` (append `devTestConsoleCreateProject`)

- [ ] **Step 1: Append endpoints to `apps-script/src/61_console_api.js`**

```javascript
/**
 * Create a project from the Console wizard. Server validates inputs and
 * calls the existing createProject_ helper, which provisions the project
 * folder. Returns the new project record (same shape as
 * consoleGetMyProjects but for a single project).
 */
function consoleCreateProject(args) {
  const actorEmail = getActorEmail_();
  const staff = assertStaff_(actorEmail);
  if (!args) throw new Error('args required');
  const name = String(args.name || '').trim();
  const schoolYear = String(args.schoolYear || '').trim();
  const bundleId = String(args.bundleId || '').trim();
  const memberClasses = Array.isArray(args.memberClasses)
    ? args.memberClasses.map((s) => String(s).trim()).filter(Boolean)
    : [];

  if (!name || name.length > 80)                  throw new Error('Name must be 1–80 characters');
  if (!schoolYear)                                throw new Error('School year required');
  if (!bundleId)                                  throw new Error('Bundle required');
  if (!getBundle_(bundleId))                      throw new Error('Unknown bundle');
  if (memberClasses.length === 0)                 throw new Error('At least one class required');

  // Teachers can only assign classes they themselves teach.
  if (!isAdmin_(staff)) {
    const taught = listClassesTaughtBy_(actorEmail);
    const outside = memberClasses.filter((c) => taught.indexOf(c) < 0);
    if (outside.length > 0) {
      throw new Error('You cannot assign classes you do not teach: ' + outside.join(', '));
    }
  }

  const project = createProject_({
    name, schoolYear, bundleId, memberClasses,
    createdBy: actorEmail,
  });

  // Return a shape compatible with consoleGetMyProjects entries (sans the
  // computed studentCount — the client refetches the list anyway).
  const bundle = getBundle_(bundleId);
  return {
    ok: true,
    project: {
      projectId: project.projectId,
      name: project.name,
      schoolYear: project.schoolYear,
      bundleId: project.bundleId,
      bundleName: bundle.name,
      memberClasses,
      scopedClasses: memberClasses,
      studentCount: 0,    // client will refetch for accurate counts
      status: project.status,
    },
  };
}

/**
 * Flip a project's status to archived. Anyone on staff can archive any
 * project. (Authorization is by staff role, not project ownership, per the
 * Phase 4 spec — admins and teachers both can archive.)
 */
function consoleArchiveProject(projectId) {
  getActorEmail_();   // not used but ensures we throw if no session
  assertStaff_(getActorEmail_());
  if (!projectId) throw new Error('projectId required');
  if (!getProject_(projectId)) throw new Error('Unknown project ' + projectId);
  archiveProject_(projectId);
  return { ok: true, projectId };
}

function consoleUnarchiveProject(projectId) {
  assertStaff_(getActorEmail_());
  if (!projectId) throw new Error('projectId required');
  if (!getProject_(projectId)) throw new Error('Unknown project ' + projectId);
  unarchiveProject_(projectId);
  return { ok: true, projectId };
}
```

- [ ] **Step 2: Append `devTestConsoleCreateProject` to `apps-script/src/99_dev.js`**

```javascript
/**
 * Tests consoleCreateProject end-to-end:
 *   - validates required fields
 *   - rejects unknown bundle
 *   - creates a project that lands in listProjects_
 *   - the project comes back from consoleGetMyProjects
 *   - archive/unarchive flips status correctly
 *
 * Cleans up by archiving the created project at the end.
 */
function devTestConsoleCreateProject() {
  devSeedDevProject();
  const bundle = listBundles_()[0];
  if (!bundle) throw new Error('No bundle seeded — run setup()');

  let pass = 0, fail = 0;
  const check = (label, cond) => {
    if (cond) { pass++; console.log('PASS ' + label); }
    else      { fail++; console.log('FAIL ' + label); }
  };

  // Validation: empty name
  let threw = false;
  try { consoleCreateProject({ name: '', schoolYear: '2026-27', bundleId: bundle.bundleId, memberClasses: ['DEV'] }); }
  catch (e) { threw = true; }
  check('empty name throws', threw);

  // Validation: zero classes
  threw = false;
  try { consoleCreateProject({ name: 'X', schoolYear: '2026-27', bundleId: bundle.bundleId, memberClasses: [] }); }
  catch (e) { threw = true; }
  check('zero classes throws', threw);

  // Validation: unknown bundle
  threw = false;
  try { consoleCreateProject({ name: 'X', schoolYear: '2026-27', bundleId: 'b-doesnt-exist', memberClasses: ['DEV'] }); }
  catch (e) { threw = true; }
  check('unknown bundle throws', threw);

  // Happy path
  const created = consoleCreateProject({
    name: 'devTest Project ' + Date.now(),
    schoolYear: '2026-27',
    bundleId: bundle.bundleId,
    memberClasses: ['DEV'],
  });
  check('create returned ok',         created && created.ok === true);
  check('create returned a projectId', !!(created.project && created.project.projectId));
  const newId = created.project.projectId;

  // Verify it lands in the registry
  const fromRegistry = getProject_(newId);
  check('project found in registry',  !!fromRegistry);
  check('status is active',           fromRegistry && fromRegistry.status === PROJECT_STATUS.ACTIVE);

  // Verify it shows up in consoleGetMyProjects (admin)
  const list = consoleGetMyProjects('active');
  const found = list.projects.find((p) => p.projectId === newId);
  check('list includes new project',  !!found);
  check('list entry has bundleName',  found && !!found.bundleName);

  // Archive
  const archResp = consoleArchiveProject(newId);
  check('archive returned ok',        archResp && archResp.ok === true);
  const afterArch = getProject_(newId);
  check('status now archived',        afterArch && afterArch.status === PROJECT_STATUS.ARCHIVED);

  // Unarchive
  const unArchResp = consoleUnarchiveProject(newId);
  check('unarchive returned ok',      unArchResp && unArchResp.ok === true);
  const afterUn = getProject_(newId);
  check('status active again',        afterUn && afterUn.status === PROJECT_STATUS.ACTIVE);

  // Final cleanup: archive again so the test project doesn't litter the registry
  consoleArchiveProject(newId);

  console.log(pass + '/' + (pass + fail) + ' passed');
}
```

- [ ] **Step 3: Push and run**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

In GAS editor, run `devTestConsoleCreateProject`. Expected: `13/13 passed`.

- [ ] **Step 4: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/61_console_api.js apps-script/src/99_dev.js
git commit -m "feat(console): create / archive / unarchive endpoints + dev test"
```

---

## Task 5: `consoleGetProjectDashboard` + end-to-end test

**Files:**
- Modify: `apps-script/src/61_console_api.js` (append endpoint)
- Modify: `apps-script/src/99_dev.js` (append `devTestConsoleDashboardEndToEnd`)

- [ ] **Step 1: Append endpoint to `apps-script/src/61_console_api.js`**

```javascript
/**
 * Per-project dashboard data. Returns precomputed aggregates per student
 * (no raw highlight/source data crosses the wire for the dashboard).
 *
 * Teacher: only sees students whose Class ∈ classes they teach AND ∈
 * project.memberClasses. Admin: sees all students in the project.
 */
function consoleGetProjectDashboard(projectId) {
  const actorEmail = getActorEmail_();
  const staff = assertStaff_(actorEmail);
  if (!projectId) throw new Error('projectId required');
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown project ' + projectId);
  const bundle = getBundle_(project.bundleId);

  const projectClasses = projectClassList_(project);
  const teacherClasses = isAdmin_(staff) ? null : listClassesTaughtBy_(actorEmail);
  const scopedClasses = isAdmin_(staff)
    ? projectClasses
    : projectClasses.filter((c) => teacherClasses.indexOf(c) >= 0);

  const rosterRows = readAllAsObjects_(
    getTab_(SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID), TABS.ROSTER),
    HEADERS.ROSTER
  );
  const enrolled = rosterRows.filter(
    (r) => r.Class && scopedClasses.indexOf(String(r.Class).trim()) >= 0
  );

  const students = enrolled.map((r) => {
    const sources = readSourcesForActor_(r.Email, projectId);
    const highlights = readHighlightsForActor_(r.Email, projectId);
    const agg = aggregateStudent_(sources, highlights, bundle);
    return {
      email: r.Email,
      name: String(r.Name || r.Email),
      class: String(r.Class || ''),
      categoryMix: agg.categoryMix,
      sourceCount: agg.sourceCount,
      highlightCount: agg.highlightCount,
      completion: agg.completion,
      gaps: agg.gaps,
      lastActivity: agg.lastActivity,
    };
  });

  return {
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
}
```

- [ ] **Step 2: Append `devTestConsoleDashboardEndToEnd` to `apps-script/src/99_dev.js`**

```javascript
/**
 * Seeds 2 students with different activity patterns in the Dev Project,
 * then calls consoleGetProjectDashboard and asserts the aggregates land
 * with the expected per-student shapes.
 *
 * The "test students" use the caller's email + unique sourceIds so they
 * land in the caller's own student sheet — devSeedDevProject already
 * sets the caller up in class "DEV".
 */
function devTestConsoleDashboardEndToEnd() {
  const project = devSeedDevProject();
  const me = Session.getEffectiveUser().getEmail();
  const ss = findOrCreateStudentSheet_(me, project);
  const bundle = listBundles_().find((b) => b.bundleId === project.bundleId);
  if (!bundle) throw new Error('Bundle missing — run setup()');

  // Seed a fresh source + 3 highlights in different categories.
  const sourceId = uuid_();
  upsertSource_(ss, {
    sourceId, projectId: project.projectId,
    rawUrl: 'https://devtest.example.com/' + sourceId,
    scrapedTitle: 'devTest Source',
    primarySecondary: 'primary',
    annotation: 'devTest annotation.',
    citationFields: JSON.stringify({
      title: 'devTest Source',
      url: 'https://devtest.example.com/' + sourceId,
    }),
    createdByEmail: me,
  });
  const cats = [bundle.label1, bundle.label2, bundle.label1];   // 2 in cat1, 1 in cat2
  cats.forEach((label) => upsertHighlight_(ss, {
    highlightId: uuid_(), sourceId, projectId: project.projectId,
    primaryCategory: label,
    highlightedText: 'devTest highlight in ' + label,
    createdByEmail: me,
  }));

  // Act.
  const resp = consoleGetProjectDashboard(project.projectId);

  let pass = 0, fail = 0;
  const check = (label, cond) => {
    if (cond) { pass++; console.log('PASS ' + label); }
    else      { fail++; console.log('FAIL ' + label); }
  };

  check('resp.ok',                         resp && resp.ok === true);
  check('project shape returned',          !!resp.project);
  check('asOf present',                    !!resp.asOf);
  check('students is an array',            Array.isArray(resp.students));
  check('≥1 student returned',             resp.students.length >= 1);

  const meRow = resp.students.find((s) => s.email === me);
  check('caller appears as a student',     !!meRow);
  if (meRow) {
    check('meRow.categoryMix length 5',    meRow.categoryMix && meRow.categoryMix.length === 5);
    // The devTest source contributes 2 highlights in cat1 + 1 in cat2.
    // Earlier devTestRoundTrip / devTestSourceDedup may have seeded other
    // highlights — assert that meRow.categoryMix[0].count ≥ 2.
    check('cat1 count ≥ 2',                meRow.categoryMix[0].count >= 2);
    check('cat2 count ≥ 1',                meRow.categoryMix[1].count >= 1);
    check('sourceCount ≥ 1',               meRow.sourceCount >= 1);
    check('highlightCount ≥ 3',            meRow.highlightCount >= 3);
    check('completion shape correct',      meRow.completion && typeof meRow.completion.percent === 'number');
    check('gaps shape correct',            meRow.gaps && typeof meRow.gaps.citation === 'number');
    check('lastActivity present',          !!meRow.lastActivity);
  }

  console.log(pass + '/' + (pass + fail) + ' passed');
}
```

- [ ] **Step 3: Push and run**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

In GAS editor, run `devTestConsoleDashboardEndToEnd`. Expected: `14/14 passed`.

- [ ] **Step 4: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/61_console_api.js apps-script/src/99_dev.js
git commit -m "feat(console): consoleGetProjectDashboard + end-to-end dev test"
```

---

## Task 6: `consoleGetStudentDetail` endpoint

**Files:**
- Modify: `apps-script/src/61_console_api.js` (append endpoint)

No dev test — the underlying aggregator + dashboard tests cover the math; the additional logic here is the per-source `formattedCitation` enrichment and the class-scope check, both shallow.

- [ ] **Step 1: Append endpoint**

```javascript
/**
 * Per-student detail for the drill-down. Includes the full aggregate set
 * (with activity-by-day), plus the student's sources with precomputed
 * formattedCitation and highlights[] embedded per source.
 *
 * Class-scope check: teachers can only fetch detail for students in
 * classes they teach. Admins can fetch any student in the project.
 */
function consoleGetStudentDetail(projectId, studentEmail) {
  const actorEmail = getActorEmail_();
  const staff = assertStaff_(actorEmail);
  if (!projectId)    throw new Error('projectId required');
  if (!studentEmail) throw new Error('studentEmail required');
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown project ' + projectId);
  const bundle = getBundle_(project.bundleId);

  // Class-scope check.
  const rosterEntry = getStudentRosterEntry_(studentEmail);
  if (!rosterEntry) throw new Error('Student not on roster: ' + studentEmail);
  const studentClass = String(rosterEntry.Class || '').trim();
  if (!isAdmin_(staff)) {
    const teacherClasses = listClassesTaughtBy_(actorEmail);
    if (teacherClasses.indexOf(studentClass) < 0) {
      throw new Error('Not authorized for student ' + studentEmail);
    }
  }
  if (projectClassList_(project).indexOf(studentClass) < 0) {
    throw new Error('Student class not enrolled in this project');
  }

  const sources = readSourcesForActor_(studentEmail, projectId);
  const highlights = readHighlightsForActor_(studentEmail, projectId);

  // Enrich each source: parsed citationFields, formattedCitation, completion flags,
  // and embedded highlights array filtered to that source.
  const enriched = sources.map((s) => {
    const parsed = parseCitationFields_(s);
    const formatted = formatCitation(
      Object.assign({}, parsed, {
        sourceType: parsed.sourceType || s.sourceType || 'website',
        title:      parsed.title      || s.scrapedTitle  || '',
        siteName:   parsed.siteName   || s.scrapedSite   || '',
        author:     parsed.author     || s.scrapedAuthor || '',
        publishedDate: parsed.publishedDate || s.scrapedDate || '',
        url:        parsed.url        || s.rawUrl || '',
        accessDate: s.accessDate || parsed.accessDate || '',
      }),
      bundle ? bundle.style : 'mla'
    );
    return {
      sourceId: s.sourceId,
      scrapedTitle: s.scrapedTitle,
      citationFieldsParsed: parsed,
      primarySecondary: s.primarySecondary || 'unset',
      annotation: s.annotation || '',
      formattedCitation: formatted,
      completionFlags: {
        citation:       !!(parsed.title && parsed.url),
        classification: s.primarySecondary && s.primarySecondary !== 'unset',
        annotation:     !!(s.annotation && String(s.annotation).trim().length > 0),
      },
      highlights: highlights
        .filter((h) => h.sourceId === s.sourceId)
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')),
      createdAt: s.createdAt,
    };
  });

  // Sort sources by createdAt desc (newest first) for the viewer.
  enriched.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  const aggregates = aggregateStudentDetail_(sources, highlights, bundle, project.createdAt);

  return {
    ok: true,
    student: {
      email: studentEmail,
      name: String(rosterEntry.Name || studentEmail),
      class: studentClass,
    },
    aggregates,
    sources: enriched,
    asOf: nowIso_(),
  };
}
```

- [ ] **Step 2: Push and smoke-check**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

In the GAS editor, smoke-test by running this one-liner in a scratch function (or paste into a new `devSmokeStudentDetail` if you prefer to keep it):

```javascript
function devSmokeStudentDetail() {
  const project = devSeedDevProject();
  const me = Session.getEffectiveUser().getEmail();
  const detail = consoleGetStudentDetail(project.projectId, me);
  console.log(JSON.stringify(detail, null, 2).slice(0, 2000));
}
```

(Optional — only if you want to inspect the shape. Not required for commit.)

- [ ] **Step 3: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/61_console_api.js
git commit -m "feat(console): consoleGetStudentDetail endpoint"
```

---

## Task 7: Console HTML stubs + doGet routing

**Files:**
- Create: `apps-script/src/console.html`
- Create: `apps-script/src/console_css.html`
- Create: `apps-script/src/console_js.html`
- Create: `apps-script/src/60_console_routing.js`
- Modify: `apps-script/src/30_endpoints.js` (add no-action branch)

After this task, opening the Web App `/exec` URL with no query string serves a minimal "Coming soon" page. The extension's existing `?action=` JSON endpoints still work unchanged.

- [ ] **Step 1: Create `apps-script/src/console.html` (minimal stub)**

```html
<!DOCTYPE html>
<html>
  <head>
    <base target="_top" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OPS Research Tool</title>
    <?!= includeFile_('console_css') ?>
  </head>
  <body>
    <div id="console-root">
      <div class="console-boot">Loading…</div>
    </div>
    <?!= includeFile_('console_js') ?>
  </body>
</html>
```

- [ ] **Step 2: Create `apps-script/src/console_css.html` (minimal stub)**

```html
<style>
:root {
  --c-text: #202124;
  --c-muted: #5f6368;
  --c-line: #dadce0;
  --c-bg: #ffffff;
  --c-soft: #f8f9fa;
  --c-accent: #1a73e8;
  --c-good: #0f9d58;
  --c-warn: #b06000;
  --c-bad: #d93025;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  color: var(--c-text);
  background: var(--c-soft);
}
.console-boot {
  padding: 60px 24px; text-align: center; color: var(--c-muted);
}
</style>
```

- [ ] **Step 3: Create `apps-script/src/console_js.html` (minimal stub)**

```html
<script>
// Stub — replaced in Task 8 with the real shell.
document.getElementById('console-root').textContent = 'OPS Research Tool — Coming soon.';
</script>
```

- [ ] **Step 4: Create `apps-script/src/60_console_routing.js`**

```javascript
/**
 * HTML serving for the Teacher Console.
 *
 * 30_endpoints.js doGet dispatches no-action requests here. Action-bearing
 * requests stay on the existing JSON dispatcher used by the Chrome extension.
 */

function serveConsoleHtml_() {
  const t = HtmlService.createTemplateFromFile('console');
  return t.evaluate()
    .setTitle('OPS Research Tool')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
```

- [ ] **Step 5: Modify `apps-script/src/30_endpoints.js` `doGet`**

Find:

```javascript
function doGet(e) {
  return jsonResponse_(handleGet_(e));
}
```

Replace with:

```javascript
function doGet(e) {
  const params = (e && e.parameter) || {};
  if (!params.action) return serveConsoleHtml_();
  return jsonResponse_(handleGet_(e));
}
```

(Everything else in `30_endpoints.js` unchanged. `doPost` unchanged.)

- [ ] **Step 6: Push**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

Expected: clean push.

- [ ] **Step 7: Verify the Web App still serves JSON for the extension**

In the GAS editor (now-canonical Web App URL is in `extension/config.js` as `WEB_APP_URL`), open a browser tab to `<WEB_APP_URL>?action=me`. Expected: JSON response with `{ok: true, actor: ...}`. Confirms the existing extension path is unchanged.

Then open `<WEB_APP_URL>` (no params) in another tab. Expected: a minimal page with text "OPS Research Tool — Coming soon."

- [ ] **Step 8: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/console.html apps-script/src/console_css.html apps-script/src/console_js.html apps-script/src/60_console_routing.js apps-script/src/30_endpoints.js
git commit -m "feat(console): scaffold HTML + doGet routing (placeholder shell)"
```

---

## Task 8: Real shell — bootstrap + auth gate + brand

**Files:**
- Modify: `apps-script/src/console_css.html` (full brand styles)
- Modify: `apps-script/src/console_js.html` (real shell with auth gate)

Before starting this task, **invoke the `anthropic-skills:ops-brand-guidelines` skill** to read the current OPS brand tokens (primary/secondary colors, typography, logo handling). Use those values in the CSS in Step 1 below. The CSS provided uses placeholders that the brand skill will tell you how to fill — replace the `/* BRAND: ... */` annotations with concrete values from the skill.

- [ ] **Step 1: Replace `apps-script/src/console_css.html` with the full styles**

```html
<style>
/* ---- OPS brand tokens ---- */
/* BRAND: replace with values from anthropic-skills:ops-brand-guidelines.
   Below are placeholders consistent with the rest of the codebase. */
:root {
  --c-text:   #202124;
  --c-muted:  #5f6368;
  --c-line:   #dadce0;
  --c-bg:     #ffffff;
  --c-soft:   #f8f9fa;
  --c-accent: #1a73e8;   /* BRAND: OPS primary blue */
  --c-good:   #0f9d58;
  --c-warn:   #b06000;
  --c-bad:    #d93025;
  --c-brand-primary:   #1a73e8;  /* BRAND: replace with OPS primary */
  --c-brand-secondary: #c5221f;  /* BRAND: replace with OPS secondary */
  --font-display: "Lexend", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-body:    "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--c-text);
  background: var(--c-soft);
}
button { font: inherit; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
select, input, textarea { font: inherit; }

/* ---- Loading + boot states ---- */
.console-boot {
  padding: 60px 24px; text-align: center; color: var(--c-muted);
}
.console-spinner {
  width: 32px; height: 32px; border-radius: 50%;
  border: 3px solid var(--c-line);
  border-top-color: var(--c-brand-primary);
  animation: console-spin 0.7s linear infinite;
  margin: 0 auto 12px;
}
@keyframes console-spin { to { transform: rotate(360deg); } }

/* ---- Top header (visible after auth) ---- */
.console-header {
  background: var(--c-bg);
  border-bottom: 1px solid var(--c-line);
  padding: 12px 24px;
  display: flex; align-items: center; gap: 16px;
}
.console-header__title {
  font-family: var(--font-display);
  font-size: 18px; font-weight: 600;
  flex: 1; min-width: 0;
}
.console-header__actor {
  font-size: 12px; color: var(--c-muted);
}
.console-header__actor strong { color: var(--c-text); font-weight: 500; }
.console-header__role-tag {
  display: inline-block; padding: 2px 8px;
  font-size: 10px; font-weight: 600; text-transform: uppercase;
  border-radius: 999px;
  background: var(--c-soft); color: var(--c-muted);
  margin-left: 6px;
}
.console-header__role-tag--admin {
  background: #fce8e6; color: var(--c-bad);
}

/* ---- Main app area ---- */
.console-main { padding: 24px; max-width: 1100px; margin: 0 auto; }
.console-empty { padding: 40px 24px; text-align: center; color: var(--c-muted); }

/* ---- Not authorized panel ---- */
.console-unauthed {
  max-width: 480px; margin: 80px auto;
  background: var(--c-bg);
  border: 1px solid var(--c-line);
  border-radius: 8px;
  padding: 32px;
  text-align: center;
}
.console-unauthed h1 {
  font-family: var(--font-display);
  margin: 0 0 12px; font-size: 20px; color: var(--c-text);
}
.console-unauthed p { color: var(--c-muted); line-height: 1.5; }
.console-unauthed code {
  background: var(--c-soft); padding: 1px 6px; border-radius: 3px;
  font-size: 13px;
}

/* ---- Status pill (toasts) ---- */
.console-status {
  position: fixed; right: 16px; bottom: 16px;
  padding: 8px 14px; border-radius: 999px;
  font-size: 13px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  background: var(--c-text); color: #fff;
  transition: opacity 0.3s;
  z-index: 100;
}
.console-status--good { background: var(--c-good); }
.console-status--bad  { background: var(--c-bad); }
.console-status--hide { opacity: 0; pointer-events: none; }
</style>
```

- [ ] **Step 2: Replace `apps-script/src/console_js.html` with the real shell**

```html
<script>
// ============================================================
// OPS Research Tool — Teacher Console
//
// Bootstrap → consoleGetContext → render auth-gated shell or
// "Not authorized" panel. Real screens land in Tasks 9+.
// ============================================================

const state = {
  ctx: null,
  view: null,            // 'MY_PROJECTS' | 'DASHBOARD' | 'STUDENT' | 'UNAUTHED' | 'BOOT'
  projectId: null,
  studentEmail: null,
};

const root = document.getElementById('console-root');

bootstrap();

function bootstrap() {
  state.view = 'BOOT';
  renderBoot_();
  google.script.run
    .withSuccessHandler(onContext_)
    .withFailureHandler(onFail_('loading session'))
    .consoleGetContext();
}

function onContext_(ctx) {
  state.ctx = ctx;
  if (!ctx || !ctx.staff) {
    state.view = 'UNAUTHED';
    renderUnauthed_();
    return;
  }
  // Real navigation comes in Task 9 (URL hash router). For now: just land
  // on the (empty) My Projects view so the shell + header render and we
  // can confirm the path end-to-end.
  state.view = 'MY_PROJECTS';
  renderShell_();
}

function renderBoot_() {
  root.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'console-boot';
  const sp = document.createElement('div');
  sp.className = 'console-spinner';
  el.appendChild(sp);
  const label = document.createElement('div');
  label.textContent = 'Loading…';
  el.appendChild(label);
  root.appendChild(el);
}

function renderUnauthed_() {
  root.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'console-unauthed';
  const h1 = document.createElement('h1');
  h1.textContent = 'Not authorized';
  wrap.appendChild(h1);
  const p1 = document.createElement('p');
  p1.textContent = 'This tool is staff-only. Sign in with your district account, or contact your district admin if you believe this is a mistake.';
  wrap.appendChild(p1);
  if (state.ctx && state.ctx.actor) {
    const p2 = document.createElement('p');
    p2.innerHTML = 'Signed in as <code></code>.';
    p2.querySelector('code').textContent = state.ctx.actor;
    wrap.appendChild(p2);
  }
  root.appendChild(wrap);
}

function renderShell_() {
  root.innerHTML = '';
  root.appendChild(buildHeader_());
  const main = document.createElement('main');
  main.className = 'console-main';
  main.id = 'console-main';
  root.appendChild(main);
  // Real views populate #console-main in Tasks 9+.
  const placeholder = document.createElement('div');
  placeholder.className = 'console-empty';
  placeholder.textContent = 'My Projects · Dashboard · Drill-down render here in later tasks.';
  main.appendChild(placeholder);
}

function buildHeader_() {
  const h = document.createElement('header');
  h.className = 'console-header';
  const title = document.createElement('div');
  title.className = 'console-header__title';
  title.textContent = 'OPS Research Tool';
  h.appendChild(title);
  const actor = document.createElement('div');
  actor.className = 'console-header__actor';
  actor.innerHTML = '<strong></strong>';
  actor.querySelector('strong').textContent = state.ctx.staff.Name || state.ctx.actor;
  const tag = document.createElement('span');
  tag.className = 'console-header__role-tag' + (state.ctx.role === 'admin' ? ' console-header__role-tag--admin' : '');
  tag.textContent = state.ctx.role;
  actor.appendChild(tag);
  h.appendChild(actor);
  return h;
}

// ---------- shared helpers ----------

function setStatus(text, kind, autoClearMs) {
  let pill = document.getElementById('console-status-pill');
  if (!pill) {
    pill = document.createElement('div');
    pill.id = 'console-status-pill';
    pill.className = 'console-status';
    document.body.appendChild(pill);
  }
  pill.textContent = text || '';
  pill.className = 'console-status' + (kind ? ' console-status--' + kind : '') + (text ? '' : ' console-status--hide');
  if (autoClearMs) {
    setTimeout(() => {
      if (pill.textContent === text) {
        pill.className = 'console-status console-status--hide';
      }
    }, autoClearMs);
  }
}

function onFail_(stage) {
  return (e) => setStatus(stage + ': ' + (e && e.message || e), 'bad', 4000);
}

function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
</script>
```

- [ ] **Step 3: Push**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

- [ ] **Step 4: Verify visually**

Open the Web App URL (no params) in a browser logged in as the staff account. Expected:
- Brief "Loading…" with spinner.
- Then the top header appears: "OPS Research Tool" + your name + `admin` tag (red).
- Main area shows the placeholder text.

Open the same URL signed in as a non-staff account (or use an incognito window to simulate). Expected:
- "Not authorized" panel with the staff-only message.

- [ ] **Step 5: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/console_css.html apps-script/src/console_js.html
git commit -m "feat(console): real shell with OPS brand + auth gate"
```

---

## Task 9: URL hash router + state machine

**Files:**
- Modify: `apps-script/src/console_js.html` (replace bootstrap/onContext with hash-router)

After this task, navigating to `#/projects`, `#/projects/<id>`, `#/projects/<id>/students/<email>` updates `state` and re-renders. The view-specific render functions are placeholders for now (filled in Tasks 10+).

- [ ] **Step 1: Replace the bottom half of `console_js.html`**

In `console_js.html`, replace the existing `onContext_`, `renderShell_`, and `buildHeader_` with the version below. Also add the new router code immediately after `bootstrap()` invocation.

Find:

```javascript
function onContext_(ctx) {
  state.ctx = ctx;
  if (!ctx || !ctx.staff) {
    state.view = 'UNAUTHED';
    renderUnauthed_();
    return;
  }
  // Real navigation comes in Task 9 (URL hash router). For now: just land
  // on the (empty) My Projects view so the shell + header render and we
  // can confirm the path end-to-end.
  state.view = 'MY_PROJECTS';
  renderShell_();
}
```

Replace with:

```javascript
function onContext_(ctx) {
  state.ctx = ctx;
  if (!ctx || !ctx.staff) {
    state.view = 'UNAUTHED';
    renderUnauthed_();
    return;
  }
  // Set up hash routing. parseHash_ → state mutation → render.
  window.addEventListener('hashchange', onHashChange_);
  applyHash_();   // initial route from whatever the URL is
}

function onHashChange_() {
  applyHash_();
}

function applyHash_() {
  const r = parseHash_(window.location.hash);
  state.view = r.view;
  state.projectId = r.projectId;
  state.studentEmail = r.studentEmail;
  renderShell_();
}

/**
 * Parse the URL hash into a route descriptor.
 *
 *   ''  or '#/projects'                                 → MY_PROJECTS
 *   '#/projects/<id>'                                   → DASHBOARD
 *   '#/projects/<id>/students/<encodedEmail>'           → STUDENT
 *   anything else                                       → MY_PROJECTS (default)
 */
function parseHash_(hash) {
  const h = String(hash || '').replace(/^#\/?/, '');
  if (!h || h === 'projects') return { view: 'MY_PROJECTS' };
  const parts = h.split('/');
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

function navigate_(path) {
  // path is a hash without the leading '#' (e.g., '/projects/<id>')
  window.location.hash = path;
}

function renderShell_() {
  root.innerHTML = '';
  root.appendChild(buildHeader_());
  const main = document.createElement('main');
  main.className = 'console-main';
  main.id = 'console-main';
  root.appendChild(main);
  renderView_(main);
}

function renderView_(main) {
  switch (state.view) {
    case 'MY_PROJECTS': return renderMyProjects_(main);
    case 'DASHBOARD':   return renderDashboard_(main);
    case 'STUDENT':     return renderStudentDetail_(main);
    default:
      main.innerHTML = '<div class="console-empty">Unknown view.</div>';
  }
}

// View render functions — placeholders filled in Tasks 10+.
function renderMyProjects_(main)    { main.innerHTML = '<div class="console-empty">My Projects (Task 10).</div>'; }
function renderDashboard_(main)     { main.innerHTML = '<div class="console-empty">Dashboard (Tasks 13–15).</div>'; }
function renderStudentDetail_(main) { main.innerHTML = '<div class="console-empty">Drill-down (Tasks 16–18).</div>'; }

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

  const actor = document.createElement('div');
  actor.className = 'console-header__actor';
  actor.innerHTML = '<strong></strong>';
  actor.querySelector('strong').textContent = state.ctx.staff.Name || state.ctx.actor;
  const tag = document.createElement('span');
  tag.className = 'console-header__role-tag' + (state.ctx.role === 'admin' ? ' console-header__role-tag--admin' : '');
  tag.textContent = state.ctx.role;
  actor.appendChild(tag);
  h.appendChild(actor);
  return h;
}
```

- [ ] **Step 2: Push and verify**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

Open the Web App URL. Expected:
- Lands on `#/projects` (or no hash) → "My Projects (Task 10)." placeholder.
- Manually change URL to `#/projects/fake-id` → "Dashboard (Tasks 13–15)." placeholder.
- Manually change to `#/projects/fake-id/students/x@y.com` → "Drill-down (Tasks 16–18)." placeholder.
- Click the "OPS Research Tool" title → URL changes back to `#/projects`, view returns.
- Browser back/forward works.

- [ ] **Step 3: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/console_js.html
git commit -m "feat(console): URL hash router + state machine"
```

---

## Task 10: My Projects screen

**Files:**
- Modify: `apps-script/src/console_css.html` (add project-card styles)
- Modify: `apps-script/src/console_js.html` (replace `renderMyProjects_` stub)

- [ ] **Step 1: Append CSS to `apps-script/src/console_css.html`**

Find the closing `</style>` and insert the following block immediately before it:

```css
/* ---- My Projects ---- */
.mp-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px;
}
.mp-title {
  font-family: var(--font-display);
  font-size: 24px; font-weight: 600; margin: 0;
}
.mp-toggle {
  display: inline-flex; gap: 2px;
  background: var(--c-bg); border: 1px solid var(--c-line);
  border-radius: 999px; padding: 2px;
}
.mp-toggle button {
  background: transparent; border: none;
  padding: 6px 14px; font-size: 13px; color: var(--c-muted);
  border-radius: 999px;
}
.mp-toggle button.mp-toggle--active {
  background: var(--c-brand-primary); color: #fff; font-weight: 500;
}
.mp-new-btn {
  background: var(--c-brand-primary); color: #fff;
  border: none; border-radius: 4px;
  padding: 8px 14px; font-weight: 500; font-size: 13px;
}
.mp-new-btn:hover { filter: brightness(1.05); }

.mp-list {
  display: grid; gap: 12px;
}
.mp-card {
  background: var(--c-bg);
  border: 1px solid var(--c-line);
  border-radius: 8px;
  padding: 16px 20px;
  display: flex; flex-direction: column; gap: 6px;
  position: relative;
}
.mp-card__name {
  font-family: var(--font-display);
  font-size: 17px; font-weight: 600;
}
.mp-card__meta {
  font-size: 13px; color: var(--c-muted);
}
.mp-card__actions {
  position: absolute; top: 16px; right: 20px;
  display: flex; gap: 8px;
}
.mp-card__open {
  background: var(--c-brand-primary); color: #fff;
  border: none; border-radius: 4px;
  padding: 6px 14px; font-weight: 500; font-size: 13px;
}
.mp-card__open:hover { filter: brightness(1.05); }
.mp-card__kebab {
  background: transparent; border: 1px solid var(--c-line);
  border-radius: 4px; padding: 6px 8px;
  font-size: 14px; color: var(--c-muted);
}
.mp-card__kebab:hover { color: var(--c-text); }
.mp-kebab-menu {
  position: absolute; top: 100%; right: 0;
  background: var(--c-bg); border: 1px solid var(--c-line);
  border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.08);
  min-width: 160px;
  z-index: 10;
}
.mp-kebab-menu button {
  width: 100%; text-align: left;
  background: transparent; border: none;
  padding: 8px 12px; font-size: 13px;
}
.mp-kebab-menu button:hover { background: var(--c-soft); }
.mp-kebab-menu button.mp-kebab-menu__danger { color: var(--c-bad); }

.mp-loading {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 48px 24px; color: var(--c-muted);
}
.mp-skeleton {
  background: var(--c-bg); border: 1px solid var(--c-line);
  border-radius: 8px; padding: 16px 20px;
  animation: console-pulse 1.4s ease-in-out infinite;
}
.mp-skeleton__line {
  height: 12px; background: var(--c-line); border-radius: 4px;
  margin-bottom: 8px;
}
.mp-skeleton__line--mid   { width: 60%; }
.mp-skeleton__line--long  { width: 90%; }
@keyframes console-pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
```

- [ ] **Step 2: Replace `renderMyProjects_` in `apps-script/src/console_js.html`**

Find:

```javascript
function renderMyProjects_(main)    { main.innerHTML = '<div class="console-empty">My Projects (Task 10).</div>'; }
```

Replace with:

```javascript
// MY_PROJECTS view-local state. Reset each time we enter the view.
const myProjects = {
  filter: 'active',   // 'active' | 'archived'
  projects: null,     // loaded by fetchMyProjects_
  openMenuId: null,   // sourceId whose kebab menu is open (null = none)
};

function renderMyProjects_(main) {
  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'mp-toolbar';
  const title = document.createElement('h1');
  title.className = 'mp-title';
  title.textContent = 'My Projects';
  toolbar.appendChild(title);

  const right = document.createElement('div');
  right.style.display = 'flex';
  right.style.gap = '12px';
  right.style.alignItems = 'center';

  const toggle = document.createElement('div');
  toggle.className = 'mp-toggle';
  ['active', 'archived'].forEach((f) => {
    const b = document.createElement('button');
    b.textContent = f.charAt(0).toUpperCase() + f.slice(1);
    if (myProjects.filter === f) b.classList.add('mp-toggle--active');
    b.addEventListener('click', () => {
      if (myProjects.filter === f) return;
      myProjects.filter = f;
      myProjects.projects = null;
      renderShell_();
      fetchMyProjects_();
    });
    toggle.appendChild(b);
  });
  right.appendChild(toggle);

  const newBtn = document.createElement('button');
  newBtn.className = 'mp-new-btn';
  newBtn.textContent = '+ New project';
  newBtn.addEventListener('click', openCreateProjectModal_);   // implemented in Task 11
  right.appendChild(newBtn);

  toolbar.appendChild(right);
  main.appendChild(toolbar);

  // Body — either skeletons (while loading) or the project list.
  const body = document.createElement('div');
  body.className = 'mp-list';
  body.id = 'mp-body';
  main.appendChild(body);

  if (myProjects.projects === null) {
    renderMpSkeletons_(body);
    fetchMyProjects_();
  } else {
    renderMpCards_(body);
  }
}

function renderMpSkeletons_(body) {
  body.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const sk = document.createElement('div');
    sk.className = 'mp-skeleton';
    const l1 = document.createElement('div');
    l1.className = 'mp-skeleton__line mp-skeleton__line--mid';
    sk.appendChild(l1);
    const l2 = document.createElement('div');
    l2.className = 'mp-skeleton__line mp-skeleton__line--long';
    sk.appendChild(l2);
    body.appendChild(sk);
  }
}

function fetchMyProjects_() {
  google.script.run
    .withSuccessHandler((resp) => {
      if (!resp || !resp.ok) {
        setStatus('Could not load projects.', 'bad', 4000);
        return;
      }
      myProjects.projects = resp.projects || [];
      renderShell_();
    })
    .withFailureHandler(onFail_('loading projects'))
    .consoleGetMyProjects(myProjects.filter);
}

function renderMpCards_(body) {
  body.innerHTML = '';
  if (myProjects.projects.length === 0) {
    const e = document.createElement('div');
    e.className = 'console-empty';
    e.textContent = myProjects.filter === 'archived'
      ? 'No archived projects.'
      : 'You’re not on any active projects. Click + New project to create one.';
    body.appendChild(e);
    return;
  }
  myProjects.projects.forEach((p) => body.appendChild(buildProjectCard_(p)));
}

function buildProjectCard_(p) {
  const card = document.createElement('div');
  card.className = 'mp-card';

  const name = document.createElement('div');
  name.className = 'mp-card__name';
  name.textContent = p.name;
  card.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'mp-card__meta';
  const parts = [
    p.schoolYear,
    p.bundleName,
    p.memberClasses.join(', '),
    p.studentCount + ' student' + (p.studentCount === 1 ? '' : 's'),
  ].filter(Boolean);
  meta.textContent = parts.join(' · ');
  card.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'mp-card__actions';
  const open = document.createElement('button');
  open.className = 'mp-card__open';
  open.textContent = 'Open';
  open.addEventListener('click', () => navigate_('/projects/' + encodeURIComponent(p.projectId)));
  actions.appendChild(open);

  const kebab = document.createElement('button');
  kebab.className = 'mp-card__kebab';
  kebab.textContent = '⋯';
  kebab.title = 'More actions';
  kebab.addEventListener('click', (e) => {
    e.stopPropagation();
    myProjects.openMenuId = myProjects.openMenuId === p.projectId ? null : p.projectId;
    renderShell_();
  });
  actions.appendChild(kebab);
  card.appendChild(actions);

  if (myProjects.openMenuId === p.projectId) {
    card.appendChild(buildKebabMenu_(p));
  }

  return card;
}

function buildKebabMenu_(p) {
  const menu = document.createElement('div');
  menu.className = 'mp-kebab-menu';
  // Position below the kebab button visually.
  menu.style.position = 'absolute';
  menu.style.top = '52px';
  menu.style.right = '20px';

  if (p.status === 'active') {
    const archBtn = document.createElement('button');
    archBtn.className = 'mp-kebab-menu__danger';
    archBtn.textContent = 'Archive…';
    archBtn.addEventListener('click', (e) => { e.stopPropagation(); confirmArchive_(p); });
    menu.appendChild(archBtn);
  } else {
    const unArchBtn = document.createElement('button');
    unArchBtn.textContent = 'Unarchive';
    unArchBtn.addEventListener('click', (e) => { e.stopPropagation(); doUnarchive_(p); });
    menu.appendChild(unArchBtn);
  }
  return menu;
}

// Archive flow + Create modal are implemented in Tasks 11–12. Stubs here so
// renderMyProjects_ doesn't reference undefined functions.
function openCreateProjectModal_() { setStatus('Create modal — Task 11.', null, 2000); }
function confirmArchive_(p)        { setStatus('Archive flow — Task 12.', null, 2000); }
function doUnarchive_(p)           { setStatus('Unarchive — Task 12.', null, 2000); }
```

Also close the kebab menu on outside clicks. Find the existing `bootstrap()` call (`bootstrap();`) and just below it, add:

```javascript
document.addEventListener('click', () => {
  if (myProjects.openMenuId !== null) {
    myProjects.openMenuId = null;
    if (state.view === 'MY_PROJECTS') renderShell_();
  }
});
```

- [ ] **Step 3: Push and verify**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

Open the Web App URL. Expected:
- Lands on `#/projects`. Brief skeleton cards, then the actual project list (at least the Dev Project should be there).
- Toggle Active/Archived switches the loaded list.
- Click `+ New project` → toast says "Create modal — Task 11."
- Click `⋯` on a card → menu appears with "Archive…". Click outside → menu closes.
- Click `Open` on a card → URL hash changes to `#/projects/<id>`, view shows the "Dashboard (Tasks 13–15)." placeholder.

- [ ] **Step 4: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/console_css.html apps-script/src/console_js.html
git commit -m "feat(console): My Projects screen with active/archived filter"
```

---

## Task 11: Create Project modal

**Files:**
- Modify: `apps-script/src/console_css.html` (add modal styles)
- Modify: `apps-script/src/console_js.html` (replace `openCreateProjectModal_` stub)

- [ ] **Step 1: Append CSS to `apps-script/src/console_css.html`** (before `</style>`)

```css
/* ---- Modal overlay (DOM-only, not a GAS dialog) ---- */
.modal-backdrop {
  position: fixed; inset: 0;
  background: rgba(32, 33, 36, 0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 50;
  padding: 20px;
}
.modal {
  background: var(--c-bg);
  border-radius: 8px;
  width: 100%; max-width: 480px;
  max-height: calc(100vh - 40px);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.modal__header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--c-line);
  font-family: var(--font-display);
  font-size: 18px; font-weight: 600;
}
.modal__body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
}
.modal__footer {
  padding: 12px 20px;
  border-top: 1px solid var(--c-line);
  display: flex; justify-content: flex-end; gap: 8px;
}
.modal__btn {
  padding: 8px 14px; border-radius: 4px; font-weight: 500; font-size: 13px;
  border: 1px solid var(--c-line); background: var(--c-bg); color: var(--c-text);
}
.modal__btn--primary {
  background: var(--c-brand-primary); color: #fff; border-color: var(--c-brand-primary);
}
.modal__btn--primary:hover:not(:disabled) { filter: brightness(1.05); }

.modal__field { margin-bottom: 14px; }
.modal__field label {
  display: block; font-size: 11px; color: var(--c-muted);
  text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px;
}
.modal__field input[type="text"],
.modal__field select {
  width: 100%; padding: 8px 10px; border: 1px solid var(--c-line);
  border-radius: 4px; font-size: 14px;
}
.modal__classes {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
  gap: 6px;
  max-height: 200px; overflow-y: auto;
  border: 1px solid var(--c-line); border-radius: 4px;
  padding: 8px;
}
.modal__class-checkbox {
  display: flex; align-items: center; gap: 6px; font-size: 13px;
}
.modal__error {
  color: var(--c-bad); font-size: 12px; margin-top: 6px;
}
```

- [ ] **Step 2: Replace `openCreateProjectModal_` in `console_js.html`**

Find:

```javascript
function openCreateProjectModal_() { setStatus('Create modal — Task 11.', null, 2000); }
```

Replace with:

```javascript
function openCreateProjectModal_() {
  const fields = {
    name: '',
    schoolYear: defaultSchoolYear_(),
    bundleId: '',
    memberClasses: [],
  };

  // Need the bundle list + the class list. Bundle list comes from a separate
  // fetch; class list we infer from the current ctx.teacherClasses (or
  // from a Roster fetch for admins).
  setStatus('Loading bundles…', null, 1000);
  google.script.run
    .withSuccessHandler((bundlesResp) => {
      const bundles = bundlesResp && bundlesResp.bundles ? bundlesResp.bundles : [];
      if (bundles.length === 0) {
        setStatus('No bundles available.', 'bad', 3000);
        return;
      }
      fields.bundleId = bundles[0].bundleId;

      // Class list: teachers see their teacherClasses; admins see all classes
      // we can find in the Roster. For admins, derive from the currently-loaded
      // project list if available; otherwise fall back to a free-text option.
      const adminAllClasses = collectKnownClasses_();
      const classOptions = state.ctx.role === 'admin'
        ? adminAllClasses
        : (state.ctx.teacherClasses || []);

      renderCreateModal_(fields, bundles, classOptions);
    })
    .withFailureHandler(onFail_('loading bundles'))
    .listBundlesForConsole_();
}

/** Derive distinct classes from currently-loaded project memberClasses lists.
 *  Best-effort: if myProjects.projects isn't loaded, returns []. */
function collectKnownClasses_() {
  const set = {};
  (myProjects.projects || []).forEach((p) => {
    (p.memberClasses || []).forEach((c) => { if (c) set[c] = true; });
  });
  return Object.keys(set).sort();
}

function defaultSchoolYear_() {
  const now = new Date();
  const y = now.getFullYear();
  // School year typically starts in August. If we're before August, current
  // school year is (prev)-(curr); else current-(next).
  return now.getMonth() >= 7 ? (y + '-' + String(y + 1).slice(2)) : ((y - 1) + '-' + String(y).slice(2));
}

function renderCreateModal_(fields, bundles, classOptions) {
  closeModal_();   // in case one is open
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'modal-backdrop';
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal_(); });

  const modal = document.createElement('div');
  modal.className = 'modal';

  const header = document.createElement('div');
  header.className = 'modal__header';
  header.textContent = 'New project';
  modal.appendChild(header);

  const body = document.createElement('div');
  body.className = 'modal__body';

  // Name
  body.appendChild(makeField_('Name', (() => {
    const i = document.createElement('input');
    i.type = 'text'; i.maxLength = 80; i.placeholder = 'e.g., NHD 2026';
    i.addEventListener('input', () => { fields.name = i.value; updateCreateBtn_(); });
    return i;
  })()));

  // School year
  body.appendChild(makeField_('School year', (() => {
    const s = document.createElement('select');
    const opts = generateSchoolYearOptions_();
    opts.forEach((y) => {
      const o = document.createElement('option');
      o.value = y; o.textContent = y;
      if (y === fields.schoolYear) o.selected = true;
      s.appendChild(o);
    });
    s.addEventListener('change', () => { fields.schoolYear = s.value; });
    return s;
  })()));

  // Bundle
  body.appendChild(makeField_('Bundle', (() => {
    const s = document.createElement('select');
    bundles.forEach((b) => {
      const o = document.createElement('option');
      o.value = b.bundleId; o.textContent = b.name;
      if (b.bundleId === fields.bundleId) o.selected = true;
      s.appendChild(o);
    });
    s.addEventListener('change', () => { fields.bundleId = s.value; });
    return s;
  })()));

  // Classes
  body.appendChild((() => {
    const wrap = document.createElement('div');
    wrap.className = 'modal__field';
    const lab = document.createElement('label');
    lab.textContent = 'Member classes';
    wrap.appendChild(lab);
    const box = document.createElement('div');
    box.className = 'modal__classes';
    if (classOptions.length === 0) {
      const note = document.createElement('div');
      note.className = 'modal__error';
      note.textContent = state.ctx.role === 'admin'
        ? 'No classes detected in your projects yet. Load existing projects first, or seed the Roster.'
        : 'You are not listed as the Teacher for any classes.';
      box.appendChild(note);
    } else {
      classOptions.forEach((c) => {
        const lbl = document.createElement('label');
        lbl.className = 'modal__class-checkbox';
        const inp = document.createElement('input');
        inp.type = 'checkbox'; inp.value = c;
        inp.addEventListener('change', () => {
          fields.memberClasses = fields.memberClasses.filter((x) => x !== c);
          if (inp.checked) fields.memberClasses.push(c);
          updateCreateBtn_();
        });
        lbl.appendChild(inp);
        lbl.appendChild(document.createTextNode(' ' + c));
        box.appendChild(lbl);
      });
    }
    wrap.appendChild(box);
    return wrap;
  })());

  const errMsg = document.createElement('div');
  errMsg.className = 'modal__error';
  errMsg.id = 'create-error';
  body.appendChild(errMsg);

  modal.appendChild(body);

  const footer = document.createElement('div');
  footer.className = 'modal__footer';
  const cancel = document.createElement('button');
  cancel.className = 'modal__btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', closeModal_);
  footer.appendChild(cancel);

  const create = document.createElement('button');
  create.className = 'modal__btn modal__btn--primary';
  create.id = 'create-btn';
  create.textContent = 'Create project';
  create.disabled = true;
  create.addEventListener('click', () => submitCreate_(fields, create));
  footer.appendChild(create);

  modal.appendChild(footer);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  function updateCreateBtn_() {
    const ok = fields.name.trim().length > 0 && fields.memberClasses.length > 0 && fields.bundleId;
    create.disabled = !ok;
  }
}

function makeField_(labelText, control) {
  const wrap = document.createElement('div');
  wrap.className = 'modal__field';
  const lab = document.createElement('label');
  lab.textContent = labelText;
  wrap.appendChild(lab);
  wrap.appendChild(control);
  return wrap;
}

function generateSchoolYearOptions_() {
  const cur = defaultSchoolYear_();
  const startYear = parseInt(cur.split('-')[0], 10);
  return [
    (startYear - 1) + '-' + String(startYear).slice(2),
    cur,
    (startYear + 1) + '-' + String(startYear + 2).slice(2),
  ];
}

function closeModal_() {
  const back = document.getElementById('modal-backdrop');
  if (back) back.remove();
}

function submitCreate_(fields, btn) {
  btn.disabled = true;
  btn.textContent = 'Creating…';
  const errEl = document.getElementById('create-error');
  if (errEl) errEl.textContent = '';
  google.script.run
    .withSuccessHandler((resp) => {
      if (resp && resp.ok) {
        closeModal_();
        setStatus('Project created.', 'good', 2500);
        myProjects.projects = null;
        renderShell_();
        fetchMyProjects_();
      } else {
        btn.disabled = false; btn.textContent = 'Create project';
        if (errEl) errEl.textContent = 'Create failed.';
      }
    })
    .withFailureHandler((e) => {
      btn.disabled = false; btn.textContent = 'Create project';
      if (errEl) errEl.textContent = String(e && e.message || e);
    })
    .consoleCreateProject(fields);
}
```

The above also calls `listBundlesForConsole_` — a tiny wrapper server endpoint that exposes the existing `listBundles_` helper to the client. Add it now:

- [ ] **Step 3: Add `listBundlesForConsole_` to `apps-script/src/61_console_api.js`** (append at bottom)

```javascript
/**
 * Surface for `google.script.run` to enumerate bundles when populating the
 * Create Project wizard. Staff-gated like the rest of the console.
 */
function listBundlesForConsole_() {
  assertStaff_(getActorEmail_());
  return { ok: true, bundles: listBundles_() };
}
```

- [ ] **Step 4: Push and verify**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

Open the Web App URL. Click `+ New project`. Expected:
- Modal opens with Name (empty), School year (current, with prev/next options), Bundle (History Day), Member classes (checkboxes for known classes).
- `Create project` button is disabled until Name is non-empty AND ≥1 class is checked.
- Click Cancel → modal closes; clicking the backdrop outside the modal also closes it.
- Submit a valid form → "Creating…" → modal closes, project list refreshes with the new project at the top, success toast.

- [ ] **Step 5: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/console_css.html apps-script/src/console_js.html apps-script/src/61_console_api.js
git commit -m "feat(console): Create Project modal wired to consoleCreateProject"
```

---

## Task 12: Archive / Unarchive flow

**Files:**
- Modify: `apps-script/src/console_js.html` (replace `confirmArchive_` / `doUnarchive_` stubs)

- [ ] **Step 1: Replace stubs in `console_js.html`**

Find:

```javascript
function confirmArchive_(p)        { setStatus('Archive flow — Task 12.', null, 2000); }
function doUnarchive_(p)           { setStatus('Unarchive — Task 12.', null, 2000); }
```

Replace with:

```javascript
function confirmArchive_(p) {
  // Close the kebab menu first so it doesn't sit under the modal.
  myProjects.openMenuId = null;
  closeModal_();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'modal-backdrop';
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal_(); });

  const modal = document.createElement('div');
  modal.className = 'modal';

  const header = document.createElement('div');
  header.className = 'modal__header';
  header.textContent = 'Archive project?';
  modal.appendChild(header);

  const body = document.createElement('div');
  body.className = 'modal__body';
  const txt = document.createElement('p');
  txt.style.margin = '0';
  txt.style.lineHeight = '1.5';
  txt.innerHTML = 'Archive <strong></strong>? Student data stays put; the project disappears from the extension’s picker and stops accepting writes.';
  txt.querySelector('strong').textContent = p.name;
  body.appendChild(txt);
  modal.appendChild(body);

  const footer = document.createElement('div');
  footer.className = 'modal__footer';
  const cancel = document.createElement('button');
  cancel.className = 'modal__btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', closeModal_);
  footer.appendChild(cancel);

  const confirm = document.createElement('button');
  confirm.className = 'modal__btn modal__btn--primary';
  confirm.style.background = 'var(--c-bad)';
  confirm.style.borderColor = 'var(--c-bad)';
  confirm.textContent = 'Archive';
  confirm.addEventListener('click', () => {
    confirm.disabled = true; confirm.textContent = 'Archiving…';
    google.script.run
      .withSuccessHandler(() => {
        closeModal_();
        setStatus('Archived.', 'good', 2500);
        myProjects.projects = null;
        renderShell_();
        fetchMyProjects_();
      })
      .withFailureHandler((e) => {
        confirm.disabled = false; confirm.textContent = 'Archive';
        setStatus('Archive failed: ' + (e && e.message || e), 'bad', 4000);
      })
      .consoleArchiveProject(p.projectId);
  });
  footer.appendChild(confirm);

  modal.appendChild(footer);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}

function doUnarchive_(p) {
  myProjects.openMenuId = null;
  setStatus('Unarchiving “' + p.name + '”…', null, 1500);
  google.script.run
    .withSuccessHandler(() => {
      setStatus('Unarchived.', 'good', 2500);
      myProjects.projects = null;
      renderShell_();
      fetchMyProjects_();
    })
    .withFailureHandler((e) => setStatus('Unarchive failed: ' + (e && e.message || e), 'bad', 4000))
    .consoleUnarchiveProject(p.projectId);
}
```

- [ ] **Step 2: Push and verify**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

Open the Web App URL. Expected:
- Open the kebab on a project card → Archive… → confirmation modal appears with project name in bold.
- Click Cancel → modal closes.
- Click Archive → "Archiving…" briefly, then modal closes, success toast, list refreshes without the archived project.
- Toggle to Archived view → see the archived project. Open kebab → Unarchive → status toast, list refreshes.

- [ ] **Step 3: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/console_js.html
git commit -m "feat(console): archive + unarchive flows"
```

---

## Task 13: Dashboard scaffolding (header, back, refresh)

**Files:**
- Modify: `apps-script/src/console_css.html` (add dashboard scaffolding styles)
- Modify: `apps-script/src/console_js.html` (replace `renderDashboard_` stub)

The dashboard header + refresh button + on-focus refresh land in this task. The all-students table (the heart of the dashboard) is the next task.

- [ ] **Step 1: Append CSS to `console_css.html`** (before `</style>`)

```css
/* ---- Dashboard scaffolding ---- */
.db-toolbar {
  display: flex; align-items: center; gap: 16px;
  margin-bottom: 16px;
}
.db-back {
  background: transparent; border: 1px solid var(--c-line);
  border-radius: 4px; padding: 6px 12px;
  font-size: 13px; color: var(--c-muted);
}
.db-back:hover { color: var(--c-text); }
.db-title {
  font-family: var(--font-display);
  font-size: 22px; font-weight: 600;
  flex: 1; min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.db-refresh {
  background: var(--c-bg); border: 1px solid var(--c-line);
  border-radius: 4px; padding: 6px 12px;
  font-size: 13px; color: var(--c-accent);
}
.db-refresh:hover:not(:disabled) { background: var(--c-soft); }
.db-asof {
  font-size: 12px; color: var(--c-muted);
  white-space: nowrap;
}
.db-body { background: var(--c-bg); border: 1px solid var(--c-line); border-radius: 8px; }
.db-empty {
  padding: 48px 24px; text-align: center; color: var(--c-muted);
}
```

- [ ] **Step 2: Replace `renderDashboard_` stub in `console_js.html`**

Find:

```javascript
function renderDashboard_(main)     { main.innerHTML = '<div class="console-empty">Dashboard (Tasks 13–15).</div>'; }
```

Replace with:

```javascript
// DASHBOARD view-local state. Reset when projectId changes.
const dashboard = {
  loadedFor: null,         // projectId of currently-loaded data
  data: null,              // { project, students, asOf }
  sortKey: 'activity',     // 'name' | 'activity' | 'completion' | 'highlights' | 'sources'
  sortDir: 'desc',         // 'asc' | 'desc'
  asOfTickHandle: null,
};

function renderDashboard_(main) {
  // Reset cache if we navigated to a different project.
  if (dashboard.loadedFor !== state.projectId) {
    dashboard.loadedFor = null;
    dashboard.data = null;
  }

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'db-toolbar';
  const back = document.createElement('button');
  back.className = 'db-back';
  back.textContent = '← My Projects';
  back.addEventListener('click', () => navigate_('/projects'));
  toolbar.appendChild(back);

  const title = document.createElement('div');
  title.className = 'db-title';
  title.id = 'db-title';
  title.textContent = 'Loading…';
  toolbar.appendChild(title);

  const refresh = document.createElement('button');
  refresh.className = 'db-refresh';
  refresh.id = 'db-refresh';
  refresh.textContent = '↻ Refresh';
  refresh.addEventListener('click', () => fetchDashboard_(state.projectId, true));
  toolbar.appendChild(refresh);

  const asof = document.createElement('div');
  asof.className = 'db-asof';
  asof.id = 'db-asof';
  asof.textContent = '';
  toolbar.appendChild(asof);

  main.appendChild(toolbar);

  const body = document.createElement('div');
  body.className = 'db-body';
  body.id = 'db-body';
  main.appendChild(body);

  if (dashboard.data) {
    paintDashboard_();
  } else {
    body.innerHTML = '';
    const loader = document.createElement('div');
    loader.className = 'mp-loading';
    const sp = document.createElement('div');
    sp.className = 'console-spinner';
    loader.appendChild(sp);
    const txt = document.createElement('div');
    txt.textContent = 'Loading dashboard…';
    loader.appendChild(txt);
    body.appendChild(loader);
    fetchDashboard_(state.projectId, false);
  }

  // Refresh on tab focus, but only while we are on the dashboard view.
  if (!window.__opsConsoleFocusBound) {
    window.__opsConsoleFocusBound = true;
    window.addEventListener('focus', () => {
      if (state.view === 'DASHBOARD' && state.projectId) fetchDashboard_(state.projectId, true);
      if (state.view === 'STUDENT' && state.projectId && state.studentEmail) {
        // Student detail focus refresh is added in Task 16; safe to keep here as a hook.
        if (typeof fetchStudentDetail_ === 'function') fetchStudentDetail_(state.projectId, state.studentEmail);
      }
    });
  }

  // Live "last refreshed" ticker
  startAsOfTicker_();
}

function fetchDashboard_(projectId, isRefresh) {
  if (isRefresh) {
    const btn = document.getElementById('db-refresh');
    if (btn) { btn.disabled = true; btn.textContent = '↻ Refreshing…'; }
  }
  google.script.run
    .withSuccessHandler((resp) => {
      if (!resp || !resp.ok) {
        setStatus('Could not load dashboard.', 'bad', 4000);
        return;
      }
      dashboard.loadedFor = projectId;
      dashboard.data = resp;
      paintDashboard_();
      const btn = document.getElementById('db-refresh');
      if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh'; }
    })
    .withFailureHandler((e) => {
      const btn = document.getElementById('db-refresh');
      if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh'; }
      onFail_('loading dashboard')(e);
    })
    .consoleGetProjectDashboard(projectId);
}

function paintDashboard_() {
  if (!dashboard.data) return;
  const proj = dashboard.data.project;
  const title = document.getElementById('db-title');
  if (title) {
    const classes = proj.scopedClasses.join(', ') || '(no classes)';
    const count = dashboard.data.students.length;
    title.textContent = proj.name + ' · ' + classes + ' · ' + count + ' student' + (count === 1 ? '' : 's');
  }

  const body = document.getElementById('db-body');
  if (!body) return;
  body.innerHTML = '';

  // Real table render lands in Task 14; for now, just confirm we have data.
  if (dashboard.data.students.length === 0) {
    const e = document.createElement('div');
    e.className = 'db-empty';
    e.textContent = 'No students enrolled in your classes for this project.';
    body.appendChild(e);
  } else {
    const e = document.createElement('div');
    e.className = 'db-empty';
    e.textContent = 'Loaded ' + dashboard.data.students.length + ' students. Table render — Task 14.';
    body.appendChild(e);
  }

  updateAsOf_();
}

function startAsOfTicker_() {
  if (dashboard.asOfTickHandle) clearInterval(dashboard.asOfTickHandle);
  dashboard.asOfTickHandle = setInterval(updateAsOf_, 10000);
}

function updateAsOf_() {
  if (!dashboard.data) return;
  const el = document.getElementById('db-asof');
  if (!el) return;
  el.textContent = 'Refreshed ' + relativeTime_(dashboard.data.asOf);
}

function relativeTime_(iso) {
  if (!iso) return 'never';
  const d = new Date(iso);
  const diff = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (diff < 60)    return Math.floor(diff) + 's ago';
  if (diff < 3600)  return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}
```

- [ ] **Step 3: Push and verify**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

From My Projects, click Open on Dev Project. Expected:
- URL changes to `#/projects/<id>`.
- Toolbar shows "← My Projects", project title with class list + student count, "↻ Refresh" button, "Refreshed Ns ago".
- Spinner briefly, then a placeholder saying "Loaded N students. Table render — Task 14."
- Click Refresh → button shows "Refreshing…" briefly, then refreshes.
- Switch tabs and back → "Refreshed" timestamp resets.

- [ ] **Step 4: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/console_css.html apps-script/src/console_js.html
git commit -m "feat(console): dashboard scaffolding (header, refresh, on-focus)"
```

---

## Task 14: All-students table

**Files:**
- Modify: `apps-script/src/console_css.html` (add table + row component styles)
- Modify: `apps-script/src/console_js.html` (replace the placeholder paint inside `paintDashboard_`)

- [ ] **Step 1: Append CSS to `console_css.html`** (before `</style>`)

```css
/* ---- Dashboard table ---- */
.db-table {
  width: 100%; border-collapse: collapse; font-size: 13px;
}
.db-table thead th {
  text-align: left; padding: 12px 12px;
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--c-muted); font-weight: 600;
  border-bottom: 1px solid var(--c-line);
  background: var(--c-bg);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.db-table thead th .db-th-arrow {
  display: inline-block; width: 12px; color: var(--c-muted);
}
.db-table tbody td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--c-line);
  vertical-align: middle;
}
.db-table tbody tr {
  cursor: pointer;
  transition: background 0.1s;
}
.db-table tbody tr:hover { background: var(--c-soft); }
.db-table tbody tr:last-child td { border-bottom: none; }

.db-row__name { font-weight: 500; }
.db-row__name-class {
  display: block; font-size: 11px; color: var(--c-muted); margin-top: 2px;
}

/* Category mix stack-bar — fixed 140px wide */
.db-mix {
  display: inline-flex; gap: 1px;
  width: 140px; height: 14px;
  background: repeating-linear-gradient(45deg, #f1f3f4 0, #f1f3f4 4px, #fff 4px, #fff 8px);
  border-radius: 3px; overflow: hidden;
  vertical-align: middle;
}
.db-mix__seg { height: 100%; }

/* Completion bar — fixed 100px */
.db-completion-wrap {
  display: inline-flex; align-items: center; gap: 8px;
  width: 160px;
}
.db-completion-bar {
  flex: 1; height: 8px; background: var(--c-line); border-radius: 4px;
  overflow: hidden;
}
.db-completion-fill { height: 100%; }
.db-completion-fill--good  { background: var(--c-good); }
.db-completion-fill--warn  { background: var(--c-warn); }
.db-completion-fill--bad   { background: var(--c-bad); }
.db-completion-pct { font-size: 11px; color: var(--c-muted); width: 32px; text-align: right; }

/* Gap chips */
.db-gaps {
  display: inline-flex; gap: 4px;
  width: 180px;
}
.db-gap {
  font-size: 10px; padding: 2px 6px; border-radius: 999px;
  font-family: var(--font-body); font-weight: 500;
  background: #e6f4ea; color: var(--c-good);
}
.db-gap--warn { background: #fef7e0; color: var(--c-warn); }
.db-gap--bad  { background: #fce8e6; color: var(--c-bad); }

/* Activity — relative timestamp */
.db-activity {
  font-size: 12px; color: var(--c-muted);
  width: 70px; white-space: nowrap;
}
.db-activity--never { color: var(--c-muted); font-style: italic; }
```

- [ ] **Step 2: Replace the placeholder in `paintDashboard_`**

Find:

```javascript
  // Real table render lands in Task 14; for now, just confirm we have data.
  if (dashboard.data.students.length === 0) {
    const e = document.createElement('div');
    e.className = 'db-empty';
    e.textContent = 'No students enrolled in your classes for this project.';
    body.appendChild(e);
  } else {
    const e = document.createElement('div');
    e.className = 'db-empty';
    e.textContent = 'Loaded ' + dashboard.data.students.length + ' students. Table render — Task 14.';
    body.appendChild(e);
  }
```

Replace with:

```javascript
  if (dashboard.data.students.length === 0) {
    const e = document.createElement('div');
    e.className = 'db-empty';
    e.textContent = 'No students enrolled in your classes for this project.';
    body.appendChild(e);
  } else {
    body.appendChild(buildDashboardTable_());
  }
```

Then add the new functions just below `paintDashboard_` (anywhere in the JS — keep them near the dashboard code):

```javascript
function buildDashboardTable_() {
  const table = document.createElement('table');
  table.className = 'db-table';

  const headers = [
    { key: 'name',         label: 'Student' },
    { key: 'highlights',   label: 'Category mix' },
    { key: 'completion',   label: 'Completion' },
    { key: 'gaps',         label: 'Gaps' },
    { key: 'activity',     label: 'Activity' },
  ];

  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  headers.forEach((h) => {
    const th = document.createElement('th');
    const sortable = (h.key !== 'gaps');   // gaps don't make sense as a sort key
    th.textContent = h.label;
    if (sortable) {
      const arrow = document.createElement('span');
      arrow.className = 'db-th-arrow';
      arrow.textContent = dashboard.sortKey === h.key ? (dashboard.sortDir === 'asc' ? '▲' : '▼') : '';
      th.appendChild(arrow);
      th.addEventListener('click', () => {
        if (dashboard.sortKey === h.key) {
          dashboard.sortDir = dashboard.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          dashboard.sortKey = h.key;
          dashboard.sortDir = (h.key === 'name') ? 'asc' : 'desc';
        }
        paintDashboard_();
      });
    } else {
      th.style.cursor = 'default';
    }
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  sortedStudents_().forEach((s) => tbody.appendChild(buildStudentRow_(s)));
  table.appendChild(tbody);

  return table;
}

function sortedStudents_() {
  const arr = dashboard.data.students.slice();
  const dir = dashboard.sortDir === 'asc' ? 1 : -1;
  switch (dashboard.sortKey) {
    case 'name':
      arr.sort((a, b) => dir * formatLastFirst_(a.name).localeCompare(formatLastFirst_(b.name)));
      break;
    case 'completion':
      arr.sort((a, b) => dir * (a.completion.percent - b.completion.percent));
      break;
    case 'highlights':
      arr.sort((a, b) => dir * (a.highlightCount - b.highlightCount));
      break;
    case 'sources':
      arr.sort((a, b) => dir * (a.sourceCount - b.sourceCount));
      break;
    case 'activity':
    default:
      arr.sort((a, b) => dir * String(a.lastActivity || '').localeCompare(String(b.lastActivity || '')));
  }
  return arr;
}

function buildStudentRow_(s) {
  const tr = document.createElement('tr');
  tr.addEventListener('click', () => {
    navigate_('/projects/' + encodeURIComponent(state.projectId) + '/students/' + encodeURIComponent(s.email));
  });

  // Name
  const tdName = document.createElement('td');
  const nameWrap = document.createElement('div');
  nameWrap.className = 'db-row__name';
  nameWrap.textContent = formatLastFirst_(s.name);
  tdName.appendChild(nameWrap);
  if (s.class) {
    const cls = document.createElement('div');
    cls.className = 'db-row__name-class';
    cls.textContent = s.class;
    tdName.appendChild(cls);
  }
  tr.appendChild(tdName);

  // Category mix stack-bar
  const tdMix = document.createElement('td');
  tdMix.appendChild(buildMixBar_(s.categoryMix));
  tr.appendChild(tdMix);

  // Completion
  const tdComp = document.createElement('td');
  tdComp.appendChild(buildCompletionCell_(s.completion));
  tr.appendChild(tdComp);

  // Gaps
  const tdGaps = document.createElement('td');
  tdGaps.appendChild(buildGapsCell_(s.gaps));
  tr.appendChild(tdGaps);

  // Activity
  const tdAct = document.createElement('td');
  tdAct.className = 'db-activity' + (s.lastActivity ? '' : ' db-activity--never');
  tdAct.textContent = s.lastActivity ? relativeTime_(s.lastActivity) : '—';
  tr.appendChild(tdAct);

  return tr;
}

function buildMixBar_(mix) {
  const wrap = document.createElement('div');
  wrap.className = 'db-mix';
  const total = mix.reduce((acc, m) => acc + m.count, 0);
  if (total === 0) return wrap;   // empty bar — hatched background only
  mix.forEach((m) => {
    if (m.count === 0) return;
    const seg = document.createElement('div');
    seg.className = 'db-mix__seg';
    seg.style.backgroundColor = m.color;
    seg.style.flex = m.count + ' 0 auto';
    seg.title = m.label + ': ' + m.count;
    wrap.appendChild(seg);
  });
  return wrap;
}

function buildCompletionCell_(comp) {
  const wrap = document.createElement('div');
  wrap.className = 'db-completion-wrap';
  const bar = document.createElement('div');
  bar.className = 'db-completion-bar';
  const fill = document.createElement('div');
  const klass = comp.percent >= 80 ? 'db-completion-fill--good'
             : comp.percent >= 40 ? 'db-completion-fill--warn'
             : 'db-completion-fill--bad';
  fill.className = 'db-completion-fill ' + klass;
  fill.style.width = comp.percent + '%';
  bar.appendChild(fill);
  wrap.appendChild(bar);
  const pct = document.createElement('div');
  pct.className = 'db-completion-pct';
  pct.textContent = comp.percent + '%';
  wrap.appendChild(pct);
  return wrap;
}

function buildGapsCell_(gaps) {
  const wrap = document.createElement('div');
  wrap.className = 'db-gaps';
  ['citation', 'classification', 'annotation'].forEach((kind) => {
    const n = gaps[kind] || 0;
    const chip = document.createElement('span');
    const klass = n === 0 ? '' : (n <= 3 ? 'db-gap--warn' : 'db-gap--bad');
    chip.className = 'db-gap ' + klass;
    const short = kind === 'citation' ? 'cit' : (kind === 'classification' ? 'cls' : 'ann');
    chip.textContent = short + ':' + n;
    chip.title = kind + ': ' + n + ' missing';
    wrap.appendChild(chip);
  });
  return wrap;
}

/** Format roster Name ("Alex Smith") as "Smith, Alex". Falls back to as-is. */
function formatLastFirst_(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  const sp = s.lastIndexOf(' ');
  if (sp < 0) return s;
  return s.slice(sp + 1) + ', ' + s.slice(0, sp);
}
```

- [ ] **Step 3: Push and verify**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

Open the Web App, navigate to a project's dashboard. Expected:
- Table with one row per student in your class scope.
- Category mix bar shows colored segments in bundle order (zero-highlight students get a hatched empty bar).
- Completion bar + percentage shown, colored green/amber/red.
- Three gap chips per row, colored green/amber/red based on counts.
- Activity column shows relative timestamp ("3m ago", "1h ago", "—").
- Click any row → navigates to `#/projects/<id>/students/<email>` (placeholder for now).
- Click column headers → sort changes; default activity descending, click again to flip.

- [ ] **Step 4: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/console_css.html apps-script/src/console_js.html
git commit -m "feat(console): dashboard all-students table with sortable columns"
```

---

## Task 15: Drill-down layout + Chart.js loader + bar/activity charts

**Files:**
- Modify: `apps-script/src/console.html` (load Chart.js via CDN)
- Modify: `apps-script/src/console_css.html` (drill-down layout styles)
- Modify: `apps-script/src/console_js.html` (replace `renderStudentDetail_` stub)

- [ ] **Step 1: Add Chart.js CDN to `console.html`**

Replace the contents of `apps-script/src/console.html` with:

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
  </body>
</html>
```

- [ ] **Step 2: Append CSS for the drill-down layout** to `console_css.html` (before `</style>`)

```css
/* ---- Drill-down ---- */
.dd-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 20px;
}
@media (max-width: 800px) {
  .dd-grid { grid-template-columns: 1fr; }
}
.dd-block {
  background: var(--c-bg);
  border: 1px solid var(--c-line);
  border-radius: 8px;
  padding: 16px 18px;
}
.dd-block__title {
  font-family: var(--font-display);
  font-size: 13px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--c-muted);
  margin: 0 0 12px;
}
.dd-block--wide { grid-column: 1 / -1; }
.dd-chart-canvas { width: 100% !important; max-height: 260px; }

/* Source-count tiles */
.dd-counts {
  display: flex; gap: 12px;
}
.dd-count-tile {
  flex: 1; padding: 14px 16px;
  background: var(--c-soft); border-radius: 6px;
  text-align: center;
}
.dd-count-tile__n {
  font-family: var(--font-display);
  font-size: 32px; font-weight: 600;
  color: var(--c-text);
}
.dd-count-tile__label {
  font-size: 11px; color: var(--c-muted);
  text-transform: uppercase; letter-spacing: 0.04em;
}
.dd-unclassified {
  margin-top: 8px; font-size: 12px; color: var(--c-muted); text-align: right;
}

/* Completion bars */
.dd-comp-row {
  display: grid;
  grid-template-columns: 140px 1fr 100px;
  gap: 12px;
  align-items: center;
  font-size: 13px;
  margin-bottom: 8px;
}
.dd-comp-label { color: var(--c-text); }
.dd-comp-bar {
  height: 8px; background: var(--c-line); border-radius: 4px; overflow: hidden;
}
.dd-comp-fill { height: 100%; }
.dd-comp-pct { font-size: 12px; color: var(--c-muted); text-align: right; }
```

- [ ] **Step 3: Replace `renderStudentDetail_` stub in `console_js.html`**

Find:

```javascript
function renderStudentDetail_(main) { main.innerHTML = '<div class="console-empty">Drill-down (Tasks 16–18).</div>'; }
```

Replace with:

```javascript
// STUDENT view-local state.
const studentDetail = {
  loadedFor: null,    // 'projectId|email'
  data: null,
  chartInstances: { categoryBar: null, activityLine: null },
};

function renderStudentDetail_(main) {
  const key = state.projectId + '|' + state.studentEmail;
  if (studentDetail.loadedFor !== key) {
    studentDetail.loadedFor = null;
    studentDetail.data = null;
    destroyDrillCharts_();
  }

  // Toolbar (back link + name + refresh + asOf)
  const toolbar = document.createElement('div');
  toolbar.className = 'db-toolbar';
  const back = document.createElement('button');
  back.className = 'db-back';
  back.textContent = '← ' + (dashboard.data && dashboard.data.project ? dashboard.data.project.name : 'Dashboard');
  back.addEventListener('click', () => navigate_('/projects/' + encodeURIComponent(state.projectId)));
  toolbar.appendChild(back);

  const title = document.createElement('div');
  title.className = 'db-title';
  title.id = 'dd-title';
  title.textContent = 'Loading…';
  toolbar.appendChild(title);

  const refresh = document.createElement('button');
  refresh.className = 'db-refresh';
  refresh.id = 'dd-refresh';
  refresh.textContent = '↻ Refresh';
  refresh.addEventListener('click', () => fetchStudentDetail_(state.projectId, state.studentEmail));
  toolbar.appendChild(refresh);

  const asof = document.createElement('div');
  asof.className = 'db-asof';
  asof.id = 'dd-asof';
  toolbar.appendChild(asof);

  main.appendChild(toolbar);

  const body = document.createElement('div');
  body.id = 'dd-body';
  main.appendChild(body);

  if (studentDetail.data) {
    paintStudentDetail_();
  } else {
    body.innerHTML = '';
    const loader = document.createElement('div');
    loader.className = 'mp-loading';
    const sp = document.createElement('div');
    sp.className = 'console-spinner';
    loader.appendChild(sp);
    const txt = document.createElement('div');
    txt.textContent = 'Loading student detail…';
    loader.appendChild(txt);
    body.appendChild(loader);
    fetchStudentDetail_(state.projectId, state.studentEmail);
  }
}

function fetchStudentDetail_(projectId, email) {
  const btn = document.getElementById('dd-refresh');
  if (btn) { btn.disabled = true; btn.textContent = '↻ Refreshing…'; }
  google.script.run
    .withSuccessHandler((resp) => {
      const btn2 = document.getElementById('dd-refresh');
      if (btn2) { btn2.disabled = false; btn2.textContent = '↻ Refresh'; }
      if (!resp || !resp.ok) {
        setStatus('Could not load student.', 'bad', 4000);
        return;
      }
      studentDetail.loadedFor = projectId + '|' + email;
      studentDetail.data = resp;
      paintStudentDetail_();
    })
    .withFailureHandler((e) => {
      const btn2 = document.getElementById('dd-refresh');
      if (btn2) { btn2.disabled = false; btn2.textContent = '↻ Refresh'; }
      onFail_('loading student detail')(e);
    })
    .consoleGetStudentDetail(projectId, email);
}

function paintStudentDetail_() {
  const d = studentDetail.data;
  if (!d) return;
  const title = document.getElementById('dd-title');
  if (title) title.textContent = formatLastFirst_(d.student.name);

  const asof = document.getElementById('dd-asof');
  if (asof) asof.textContent = 'Refreshed ' + relativeTime_(d.asOf);

  const body = document.getElementById('dd-body');
  if (!body) return;
  body.innerHTML = '';
  body.appendChild(buildDrillGrid_());

  // Chart blocks need their canvas elements in the DOM first. Build the
  // Chart.js instances after this microtask so the canvas refs resolve.
  setTimeout(buildDrillCharts_, 0);
}

function buildDrillGrid_() {
  const d = studentDetail.data;
  const grid = document.createElement('div');
  grid.className = 'dd-grid';

  // 1. Highlights by category — bar chart (the star)
  const barBlock = document.createElement('div');
  barBlock.className = 'dd-block dd-block--wide';
  const barTitle = document.createElement('h3');
  barTitle.className = 'dd-block__title';
  barTitle.textContent = 'Highlights by category';
  barBlock.appendChild(barTitle);
  const barCanvas = document.createElement('canvas');
  barCanvas.id = 'dd-chart-bar';
  barCanvas.className = 'dd-chart-canvas';
  barBlock.appendChild(barCanvas);
  grid.appendChild(barBlock);

  // 2. Source counts
  const countsBlock = document.createElement('div');
  countsBlock.className = 'dd-block';
  const countsTitle = document.createElement('h3');
  countsTitle.className = 'dd-block__title';
  countsTitle.textContent = 'Sources';
  countsBlock.appendChild(countsTitle);
  countsBlock.appendChild(buildDrillCountsTiles_(d.aggregates.sourceCounts));
  grid.appendChild(countsBlock);

  // 3. Completion breakdown
  const compBlock = document.createElement('div');
  compBlock.className = 'dd-block';
  const compTitle = document.createElement('h3');
  compTitle.className = 'dd-block__title';
  compTitle.textContent = 'Completion';
  compBlock.appendChild(compTitle);
  compBlock.appendChild(buildDrillCompletion_(d.aggregates.completion));
  grid.appendChild(compBlock);

  // 4. Activity over time
  const actBlock = document.createElement('div');
  actBlock.className = 'dd-block dd-block--wide';
  const actTitle = document.createElement('h3');
  actTitle.className = 'dd-block__title';
  actTitle.textContent = 'Activity over time';
  actBlock.appendChild(actTitle);
  const actCanvas = document.createElement('canvas');
  actCanvas.id = 'dd-chart-activity';
  actCanvas.className = 'dd-chart-canvas';
  actBlock.appendChild(actCanvas);
  grid.appendChild(actBlock);

  return grid;
}

function buildDrillCountsTiles_(c) {
  const wrap = document.createElement('div');
  wrap.className = 'dd-counts';
  const tile = (n, label) => {
    const t = document.createElement('div');
    t.className = 'dd-count-tile';
    const num = document.createElement('div');
    num.className = 'dd-count-tile__n';
    num.textContent = n;
    t.appendChild(num);
    const lab = document.createElement('div');
    lab.className = 'dd-count-tile__label';
    lab.textContent = label;
    t.appendChild(lab);
    return t;
  };
  wrap.appendChild(tile(c.primary, 'Primary'));
  wrap.appendChild(tile(c.secondary, 'Secondary'));
  const outer = document.createElement('div');
  outer.appendChild(wrap);
  if (c.unset > 0) {
    const un = document.createElement('div');
    un.className = 'dd-unclassified';
    un.textContent = 'Unclassified: ' + c.unset;
    outer.appendChild(un);
  }
  return outer;
}

function buildDrillCompletion_(comp) {
  const wrap = document.createElement('div');
  ['citation', 'classification', 'annotation'].forEach((kind) => {
    const c = comp[kind];
    const pct = c.total === 0 ? 0 : Math.round((c.complete / c.total) * 100);
    const row = document.createElement('div');
    row.className = 'dd-comp-row';
    const lab = document.createElement('div');
    lab.className = 'dd-comp-label';
    lab.textContent = kind.charAt(0).toUpperCase() + kind.slice(1);
    row.appendChild(lab);
    const bar = document.createElement('div');
    bar.className = 'dd-comp-bar';
    const fill = document.createElement('div');
    const klass = pct >= 80 ? 'db-completion-fill--good'
               : pct >= 40 ? 'db-completion-fill--warn'
               : 'db-completion-fill--bad';
    fill.className = 'dd-comp-fill ' + klass;
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    row.appendChild(bar);
    const pctTxt = document.createElement('div');
    pctTxt.className = 'dd-comp-pct';
    pctTxt.textContent = c.complete + ' / ' + c.total;
    row.appendChild(pctTxt);
    wrap.appendChild(row);
  });
  return wrap;
}

function buildDrillCharts_() {
  destroyDrillCharts_();
  if (typeof Chart === 'undefined') return;
  const d = studentDetail.data;

  // Bar chart — highlights by category
  const barEl = document.getElementById('dd-chart-bar');
  if (barEl) {
    studentDetail.chartInstances.categoryBar = new Chart(barEl, {
      type: 'bar',
      data: {
        labels: d.aggregates.categoryMix.map((m) => m.label),
        datasets: [{
          label: 'Highlights',
          data: d.aggregates.categoryMix.map((m) => m.count),
          backgroundColor: d.aggregates.categoryMix.map((m) => m.color),
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 } },
          x: { ticks: { autoSkip: false } },
        },
      },
    });
  }

  // Line chart — activity over time
  const lineEl = document.getElementById('dd-chart-activity');
  if (lineEl) {
    studentDetail.chartInstances.activityLine = new Chart(lineEl, {
      type: 'line',
      data: {
        labels: d.aggregates.activityByDay.map((a) => a.date),
        datasets: [
          {
            label: 'Highlights',
            data: d.aggregates.activityByDay.map((a) => a.highlights),
            borderColor: '#1a73e8',
            backgroundColor: 'rgba(26, 115, 232, 0.15)',
            tension: 0.2,
            fill: true,
          },
          {
            label: 'Sources',
            data: d.aggregates.activityByDay.map((a) => a.sources),
            borderColor: '#d62728',
            backgroundColor: 'rgba(214, 39, 40, 0.15)',
            tension: 0.2,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 } },
        },
      },
    });
  }
}

function destroyDrillCharts_() {
  if (studentDetail.chartInstances.categoryBar) {
    studentDetail.chartInstances.categoryBar.destroy();
    studentDetail.chartInstances.categoryBar = null;
  }
  if (studentDetail.chartInstances.activityLine) {
    studentDetail.chartInstances.activityLine.destroy();
    studentDetail.chartInstances.activityLine = null;
  }
}
```

- [ ] **Step 4: Push and verify**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

Open the Web App, navigate to a project's dashboard, click a row. Expected:
- URL changes to `#/projects/<id>/students/<email>`.
- "← <project name>" back link works.
- Title shows student name in "Last, First" format.
- Four blocks render:
  1. Wide block at the top: bar chart of highlights by category (bundle colors).
  2. Sources tile pair (Primary / Secondary), with Unclassified note if any.
  3. Completion 3-row block with progress bars.
  4. Wide block at the bottom: activity-over-time line chart (Highlights + Sources).
- Refresh button updates data and asOf timestamp.

- [ ] **Step 5: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/console.html apps-script/src/console_css.html apps-script/src/console_js.html
git commit -m "feat(console): drill-down with 4 chart/info blocks (Chart.js)"
```

---

## Task 16: Sources & highlights viewer (drill-down bottom section)

**Files:**
- Modify: `apps-script/src/console_css.html` (add sources-viewer styles)
- Modify: `apps-script/src/console_js.html` (append source-viewer render after `buildDrillGrid_`)

- [ ] **Step 1: Append CSS** to `console_css.html` (before `</style>`)

```css
/* ---- Drill-down: sources & highlights viewer ---- */
.dd-sources {
  background: var(--c-bg);
  border: 1px solid var(--c-line);
  border-radius: 8px;
  padding: 16px 18px;
  margin-top: 20px;
}
.dd-sources__title {
  font-family: var(--font-display);
  font-size: 14px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--c-muted);
  margin: 0 0 16px;
}
.dd-source-card {
  border: 1px solid var(--c-line);
  border-radius: 6px;
  padding: 12px 14px;
  margin-bottom: 10px;
  background: var(--c-soft);
}
.dd-source-card__head {
  display: flex; align-items: baseline; gap: 8px;
  flex-wrap: wrap;
}
.dd-source-card__title {
  font-size: 15px; font-weight: 500; color: var(--c-text);
  flex: 1; min-width: 0;
}
.dd-source-card__chip {
  font-size: 10px; padding: 2px 6px; border-radius: 999px;
}
.dd-source-card__chip--primary   { background: #e6f4ea; color: var(--c-good); }
.dd-source-card__chip--secondary { background: #e8f0fe; color: var(--c-accent); }
.dd-source-card__chip--unset     { background: #fce8e6; color: var(--c-bad); }
.dd-source-card__count {
  font-size: 11px; color: var(--c-muted);
}
.dd-source-card__flags {
  display: inline-flex; gap: 4px; margin-left: auto;
}
.dd-source-card__flag {
  font-size: 10px; padding: 2px 6px; border-radius: 999px;
  background: var(--c-bg); border: 1px solid var(--c-line);
  color: var(--c-muted);
}
.dd-source-card__flag--complete { background: #e6f4ea; color: var(--c-good); border-color: transparent; }
.dd-source-card__flag--gap      { background: #fce8e6; color: var(--c-bad); border-color: transparent; }
.dd-source-card__citation {
  font-size: 12px; color: var(--c-text); margin-top: 8px;
  background: var(--c-bg); padding: 8px 10px; border-radius: 4px;
  border: 1px solid var(--c-line);
}
.dd-source-card__citation em { font-style: italic; }
.dd-source-card__annotation {
  font-size: 12px; color: var(--c-text); margin-top: 6px; font-style: italic;
}
.dd-cat-group {
  margin-top: 8px;
}
.dd-cat-group__title {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--c-muted); margin: 6px 0 4px;
}
.dd-hl {
  position: relative;
  padding: 6px 8px 6px 14px;
  background: var(--c-bg);
  border: 1px solid var(--c-line); border-radius: 4px;
  font-size: 12px; line-height: 1.4;
  margin-bottom: 4px;
}
.dd-hl__bar {
  position: absolute; top: 6px; bottom: 6px; left: 4px; width: 4px; border-radius: 2px;
}
.dd-hl__note {
  font-style: italic; color: var(--c-muted); font-size: 11px; margin-top: 4px;
}
.dd-source-card__expand {
  background: transparent; border: none; color: var(--c-accent);
  font-size: 12px; padding: 4px 0;
}
.dd-show-all {
  margin-top: 12px; text-align: center;
}
.dd-show-all button {
  background: var(--c-bg); border: 1px solid var(--c-line);
  border-radius: 4px; padding: 8px 14px;
  color: var(--c-accent); font-size: 13px;
}
```

- [ ] **Step 2: Wire the viewer into `paintStudentDetail_` in `console_js.html`**

Find:

```javascript
  body.innerHTML = '';
  body.appendChild(buildDrillGrid_());

  // Chart blocks need their canvas elements in the DOM first. Build the
  // Chart.js instances after this microtask so the canvas refs resolve.
  setTimeout(buildDrillCharts_, 0);
}
```

Replace with:

```javascript
  body.innerHTML = '';
  body.appendChild(buildDrillGrid_());
  body.appendChild(buildSourcesViewer_());

  // Chart blocks need their canvas elements in the DOM first. Build the
  // Chart.js instances after this microtask so the canvas refs resolve.
  setTimeout(buildDrillCharts_, 0);
}

const SOURCES_DEFAULT_VISIBLE = 5;
const SOURCES_DEFAULT_HL_COLLAPSE = 8;

function buildSourcesViewer_() {
  const d = studentDetail.data;
  const wrap = document.createElement('div');
  wrap.className = 'dd-sources';
  const title = document.createElement('h3');
  title.className = 'dd-sources__title';
  title.textContent = 'Sources & highlights';
  wrap.appendChild(title);

  const showAll = !!studentDetail.showAllSources;
  const visible = showAll ? d.sources : d.sources.slice(0, SOURCES_DEFAULT_VISIBLE);

  if (visible.length === 0) {
    const e = document.createElement('div');
    e.className = 'console-empty';
    e.textContent = 'No sources yet.';
    e.style.padding = '20px';
    wrap.appendChild(e);
    return wrap;
  }

  visible.forEach((s) => wrap.appendChild(buildSourceCard_(s)));

  if (!showAll && d.sources.length > SOURCES_DEFAULT_VISIBLE) {
    const more = document.createElement('div');
    more.className = 'dd-show-all';
    const btn = document.createElement('button');
    btn.textContent = 'Show all (' + d.sources.length + ')';
    btn.addEventListener('click', () => {
      studentDetail.showAllSources = true;
      paintStudentDetail_();
    });
    more.appendChild(btn);
    wrap.appendChild(more);
  }
  return wrap;
}

function buildSourceCard_(s) {
  const card = document.createElement('div');
  card.className = 'dd-source-card';

  // Head: title + ps chip + count + completion flags
  const head = document.createElement('div');
  head.className = 'dd-source-card__head';
  const t = document.createElement('div');
  t.className = 'dd-source-card__title';
  t.textContent = (s.citationFieldsParsed && s.citationFieldsParsed.title) || s.scrapedTitle || '(untitled)';
  head.appendChild(t);

  const chip = document.createElement('span');
  chip.className = 'dd-source-card__chip dd-source-card__chip--' + s.primarySecondary;
  chip.textContent = s.primarySecondary;
  head.appendChild(chip);

  const cnt = document.createElement('span');
  cnt.className = 'dd-source-card__count';
  cnt.textContent = s.highlights.length + ' highlight' + (s.highlights.length === 1 ? '' : 's');
  head.appendChild(cnt);

  const flags = document.createElement('div');
  flags.className = 'dd-source-card__flags';
  flags.appendChild(makeFlagChip_('cit', s.completionFlags.citation));
  flags.appendChild(makeFlagChip_('cls', s.completionFlags.classification));
  flags.appendChild(makeFlagChip_('ann', s.completionFlags.annotation));
  head.appendChild(flags);

  card.appendChild(head);

  // Citation (with italics)
  if (s.formattedCitation && s.formattedCitation.text) {
    const cite = document.createElement('div');
    cite.className = 'dd-source-card__citation';
    cite.innerHTML = renderCitationHtml_(s.formattedCitation);
    card.appendChild(cite);
  }

  // Annotation (if present)
  if (s.annotation) {
    const ann = document.createElement('div');
    ann.className = 'dd-source-card__annotation';
    ann.textContent = '“' + s.annotation + '”';
    card.appendChild(ann);
  }

  // Highlights grouped by primary category. Collapsed if many.
  if (s.highlights.length > 0) {
    const collapseByDefault = s.highlights.length > SOURCES_DEFAULT_HL_COLLAPSE;
    const key = 'expand:' + s.sourceId;
    const expanded = studentDetail.expanded && studentDetail.expanded[key];
    if (collapseByDefault && !expanded) {
      const btn = document.createElement('button');
      btn.className = 'dd-source-card__expand';
      btn.textContent = 'Show ' + s.highlights.length + ' highlights';
      btn.addEventListener('click', () => {
        studentDetail.expanded = studentDetail.expanded || {};
        studentDetail.expanded[key] = true;
        paintStudentDetail_();
      });
      card.appendChild(btn);
    } else {
      card.appendChild(buildHighlightGroups_(s));
    }
  }

  return card;
}

function makeFlagChip_(kind, complete) {
  const chip = document.createElement('span');
  chip.className = 'dd-source-card__flag ' + (complete ? 'dd-source-card__flag--complete' : 'dd-source-card__flag--gap');
  chip.textContent = (complete ? '✓ ' : '✗ ') + kind;
  return chip;
}

function buildHighlightGroups_(s) {
  const wrap = document.createElement('div');
  const groups = {};
  s.highlights.forEach((h) => {
    const k = h.primaryCategory || '(no category)';
    if (!groups[k]) groups[k] = [];
    groups[k].push(h);
  });
  Object.keys(groups).forEach((cat) => {
    const g = document.createElement('div');
    g.className = 'dd-cat-group';
    const gt = document.createElement('div');
    gt.className = 'dd-cat-group__title';
    gt.textContent = cat + ': ' + groups[cat].length + ' highlight' + (groups[cat].length === 1 ? '' : 's');
    g.appendChild(gt);
    groups[cat].forEach((h) => g.appendChild(buildHighlightItem_(h)));
    wrap.appendChild(g);
  });
  return wrap;
}

function buildHighlightItem_(h) {
  const row = document.createElement('div');
  row.className = 'dd-hl';
  const bar = document.createElement('div');
  bar.className = 'dd-hl__bar';
  bar.style.backgroundColor = colorForCategoryInDrill_(h.primaryCategory) || '#dadce0';
  row.appendChild(bar);
  const txt = document.createElement('div');
  txt.textContent = h.highlightedText || '';
  row.appendChild(txt);
  if (h.note) {
    const note = document.createElement('div');
    note.className = 'dd-hl__note';
    note.textContent = h.note;
    row.appendChild(note);
  }
  return row;
}

function colorForCategoryInDrill_(label) {
  if (!studentDetail.data || !studentDetail.data.aggregates) return null;
  const found = studentDetail.data.aggregates.categoryMix.find((m) => m.label === label);
  return found ? found.color : null;
}

function renderCitationHtml_(formatted) {
  const text = formatted.text || '';
  const italics = formatted.italics || [];
  let html = '';
  let cursor = 0;
  italics.forEach(([s, e]) => {
    if (s > cursor) html += esc_(text.slice(cursor, s));
    html += '<em>' + esc_(text.slice(s, e)) + '</em>';
    cursor = e;
  });
  if (cursor < text.length) html += esc_(text.slice(cursor));
  return html;
}
```

- [ ] **Step 3: Push and verify**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

Open a student's drill-down. Expected:
- Below the four chart blocks: "Sources & highlights" header + one card per source (up to 5 by default).
- Each source card shows: title, classification chip, highlight count, completion flag chips, citation (with italics), annotation in italics.
- Sources with > 8 highlights show a "Show N highlights" button; clicking reveals the highlight groups.
- Sources with ≤ 8 highlights show the highlight groups immediately, grouped by primary category, each highlight color-barred.
- If > 5 sources, "Show all (N)" button at the bottom; clicking expands the list.

- [ ] **Step 4: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/console_css.html apps-script/src/console_js.html
git commit -m "feat(console): drill-down sources & highlights viewer"
```

---

## Task 17: Final manual QA + brand polish + push

**Files:**
- None (verification only — fixes may touch existing files).

This task runs the full manual QA matrix from the spec and applies any polish needed.

- [ ] **Step 1: Apply OPS brand**

Invoke the `anthropic-skills:ops-brand-guidelines` skill. Update the `:root` block in `apps-script/src/console_css.html` to use the OPS brand colors and typography returned by the skill. Replace the placeholder `--c-brand-primary` and `--c-brand-secondary` values, and verify `--font-display` and `--font-body` use whatever the brand spec specifies. If the brand spec requires a logo, add a small `<img>` to `buildHeader_` in `console_js.html` (load via `data:` URI or as a Google Drive image — defer to the brand skill's guidance).

Push, reload, eyeball that the colors and typography look on-brand.

- [ ] **Step 2: Full QA matrix from spec §14**

Run through each item; fix issues as encountered.

**Sign in & navigation:**
- [ ] Sign in as staff → console loads with header, no errors in browser console.
- [ ] My Projects list shows active projects.
- [ ] Click Open → Dashboard loads.
- [ ] Click a student row → Drill-down loads.
- [ ] Click `←` breadcrumb → returns to dashboard.
- [ ] Browser back/forward → restores view + URL.
- [ ] Click Refresh on dashboard → asOf updates.
- [ ] Switch tab and back → on-focus refresh fires.

**Layout:**
- [ ] Resize browser narrow → table stays scannable (horizontal scroll OK).
- [ ] Drill-down charts stack vertically on narrow widths.

**Create / Archive / Unarchive:**
- [ ] Click + New project → modal opens.
- [ ] Try empty name → Create disabled.
- [ ] Try zero classes → Create disabled.
- [ ] Submit valid input → modal closes, new project at top.
- [ ] Archive a project → confirmation, confirm, project moves out of Active.
- [ ] Switch to Archived view → archived project visible. Unarchive → returns to Active.

**Security:**
- [ ] Open dev tools as non-staff user; paste `google.script.run.consoleGetMyProjects('active')` → server throws.
- [ ] Reload as non-staff user → "Not authorized" panel.

**Dev tests still green:**
In GAS editor:
- [ ] `devTestNormalizeUrl` → 8/8
- [ ] `devTestRoundTrip` → no errors
- [ ] `devTestDeleteSource` → 9/9
- [ ] `devTestAggregateStudent` → 15/15
- [ ] `devTestConsoleAuth` → 7/7
- [ ] `devTestConsoleProjectsFilter` → 9/9
- [ ] `devTestConsoleCreateProject` → 13/13
- [ ] `devTestConsoleDashboardEndToEnd` → 14/14

- [ ] **Step 3: Final commit (if any QA fixes landed) + push**

```powershell
cd C:\dev\ops-research-tool
git status
```

If anything is uncommitted:

```powershell
git add -A
git commit -m "fix(console): QA cleanup for teacher console v1"
```

Then push:

```powershell
cd C:\dev\ops-research-tool
git push -u origin feature/teacher-console
```

GitHub Actions will redeploy the GAS Web App per CLAUDE.md §11. Confirm the Actions tab shows a green deploy.

- [ ] **Step 4: Merge to main**

```powershell
cd C:\dev\ops-research-tool
git checkout main
git pull origin main
git merge --no-ff feature/teacher-console -m "Merge branch 'feature/teacher-console'

Phase 4 sub-project A+B: Teacher Console foundation, My Projects, and
Project Dashboard with Student Drill-Down. Adds the third surface
(after the Chrome extension and Docs sidebar) on the same GAS web app
deployment.

See docs/superpowers/specs/2026-05-27-teacher-console-design.md and
docs/superpowers/plans/2026-05-27-teacher-console.md."
git push origin main
```

---

## Self-Review (already run before delivery)

- **Spec coverage:**
  - §4 architecture → Tasks 7–9.
  - §5 auth → Task 2 (server) + Task 8 (client gate).
  - §6 My Projects → Task 10.
  - §7 Create modal → Task 11.
  - §8 Project Dashboard → Tasks 13–14.
  - §9 Student Drill-Down → Tasks 15–16.
  - §10 Archive/Unarchive → Task 12.
  - §11 Endpoints → Tasks 2–6.
  - §12 Aggregator → Task 1.
  - §13 doGet mod → Task 7 Step 5.
  - §14 Testing → 5 devTest functions across Tasks 1, 2, 3, 4, 5; manual QA → Task 17.

- **Placeholder scan:** no TBDs, no "implement later", no naked "handle errors". Every step has either exact code or exact verification expectations. One placeholder zone is intentional: the OPS brand color tokens in Task 8 Step 1 are explicitly marked with `/* BRAND: */` and Task 17 Step 1 directs the implementer to invoke the brand skill to fill them — that's a deliberate handoff, not a plan failure.

- **Type consistency:** function and state names are stable across tasks. `state.view` ∈ `{'BOOT','UNAUTHED','MY_PROJECTS','DASHBOARD','STUDENT'}` used consistently. `consoleGetContext`, `consoleGetMyProjects`, `consoleCreateProject`, `consoleArchiveProject`, `consoleUnarchiveProject`, `consoleGetProjectDashboard`, `consoleGetStudentDetail`, `listBundlesForConsole_` referenced identically client-side and server-side. The dashboard's data shape (`{project, students, asOf}`) is produced by `consoleGetProjectDashboard` (Task 5) and consumed in Tasks 13–14. The drill-down's data shape (`{student, aggregates, sources, asOf}`) is produced by `consoleGetStudentDetail` (Task 6) and consumed in Tasks 15–16.
