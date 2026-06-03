# Custom Highlight Bundles — Stage B: Custom (student-defined) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Custom" project type where each student defines their own 5 `(color, label)` highlight categories, surfaced in the extension/sidebar/Docs-sidebar and aggregated by slot on the teacher dashboard.

**Architecture:** A single seeded reserved "Custom" bundle row (marked by a new `custom` column) is what a custom project references. Each student's personal `(labels, colors)` live in ScriptProperties (`prefs:<email>:customBundle:<projectId>`). A new `categorySlot` (1–5) column on Highlights is the stable category identity (labels/colors re-derive from the student's bundle by slot, so edits never orphan). Every consumer (extension toolbar/sidebar, Docs sidebar, dashboard) is fed the student's *effective* bundle so existing label-based code keeps working.

**Tech Stack:** Apps Script (V8), MV3 extension (vanilla JS, shadow-DOM sidebar), HtmlService console, ScriptProperties, `google.script.run` + Web App REST.

**Spec:** [`docs/superpowers/specs/2026-06-03-custom-highlight-bundles-design.md`](../specs/2026-06-03-custom-highlight-bundles-design.md) (Stage B). **Depends on Stage A** (the wizard bundle-field rework lands first).

**Key reference facts:**
- Pref helpers — [`04_user_prefs.js`](../../apps-script/src/04_user_prefs.js): `PREFS_PREFIX = 'prefs:'`, `userPrefKey_(email,key)='prefs:'+lower(email)+':'+key`, `getUserPref_`, `setUserPref_` (deletes on empty value).
- `PRESET_PALETTE`, `createBundle_`, `listBundles_`, `getBundle_` — [`13_bundles.js`](../../apps-script/src/13_bundles.js).
- `HEADERS` — [`02_constants.js:25`](../../apps-script/src/02_constants.js): `BUNDLES`, `HIGHLIGHTS`. `ensureHeaders_` auto-heals a pure trailing append (CLAUDE.md §4), so appended columns self-migrate.
- `upsertHighlight_` — [`20_writes.js:48`](../../apps-script/src/20_writes.js): builds a positional `row` from `HEADERS.HIGHLIGHTS`.
- `formatBundleCategoryMix_(highlights, bundle)` / `aggregateStudent_(sources, highlights, bundle)` — [`62_aggregator.js:20,48`](../../apps-script/src/62_aggregator.js).
- Dashboard compute — [`61_console_api.js:344`](../../apps-script/src/61_console_api.js) `computeDashboardParallel_`, `:457` `computeDashboardSerial_` (both call `aggregateStudent_(..., bundle)` once per student/group with the single project bundle).
- doGet/doPost dispatch — [`30_endpoints.js`](../../apps-script/src/30_endpoints.js): `handleGet_` switch (`:122`), `handlePost_` `body.action` special-case (`:33` `setActiveProject`).
- Extension service worker — [`background.js`](../../extension/background.js): `getActiveProjectInfo` (`:500`, resolves `bundle` from `cachedBundles`), `handleMessage` switch (`:152`), `enqueueHighlight` (`:477`), `refreshContext` (`:535`). Cache helpers `getCache`/`setCache` (`shared/storage.js`).
- In-page sidebar — [`content/sidebar.js`](../../extension/content/sidebar.js): `state.bundle`, `colorForLabel_` (`:1119`), `renderFacetList_` (`:979`), `loadForCurrentPage` (`:442`, builds `state.pageHighlights`), `renderPanel_` (`:707`), `loadContext_` (`:607`).
- Toolbar — [`content/toolbar.js`](../../extension/content/toolbar.js): `draftCategory`/`draftColor` (`:31`), swatch loop `renderToolbar_` (`:209`), `commitDraft_` (`:158`), `syncHighlight_` (`:283`).
- Docs sidebar — [`53_sidebar_api.js`](../../apps-script/src/53_sidebar_api.js): `sidebarGetContext` (`:17`, returns `activeBundle`), `sidebarOpenSourceEditor` (`:357`, `t.bundleJson`).

**Push/test workflow:** identical to Stage A (PATH refresh + `clasp push -f`; run `devTest*` from the editor; `clasp run` unavailable). Pure-logic tests can also be sanity-checked in Node.

---

### Task B1: Additive schema columns (`custom`, `categorySlot`)

**Files:**
- Modify: `apps-script/src/02_constants.js` (`HEADERS.BUNDLES`, `HEADERS.HIGHLIGHTS`)

- [ ] **Step 1: Add the columns**

In `HEADERS.BUNDLES` ([`02_constants.js:34`](../../apps-script/src/02_constants.js)) append `'custom'` as the LAST element:

```javascript
  BUNDLES: [
    'bundleId', 'name', 'style',
    'label1', 'label2', 'label3', 'label4', 'label5',
    'color1', 'color2', 'color3', 'color4', 'color5',
    'createdBy', 'createdAt',
    'custom',          // additive — TRUE only on the reserved Custom bundle
  ],
```

In `HEADERS.HIGHLIGHTS` ([`02_constants.js:56`](../../apps-script/src/02_constants.js)) append `'categorySlot'` as the LAST element:

```javascript
  HIGHLIGHTS: [
    'highlightId', 'sourceId', 'projectId',
    'primaryCategory', 'secondaryCategory',
    'highlightedText', 'note',
    'createdByEmail', 'createdAt',
    'categorySlot',    // additive — '1'..'5' for custom projects, blank otherwise
  ],
```

- [ ] **Step 2: Verify nothing regressed (append-heal works)**

`clasp push -f`, then run `devTestRoundTrip` and `devTestEnsureHeadersAppend` from the editor.
Expected: both PASS — existing Sheets self-heal the new trailing columns on next write; positional mapping stays correct.

- [ ] **Step 3: Commit**

```powershell
cd C:\Users\paul.ivers\Desktop\ops-research-tool
git add apps-script/src/02_constants.js
git commit -m "feat(schema): additive custom (Bundles) + categorySlot (Highlights) columns"
```

---

### Task B2: Custom-bundle helpers + reserved-bundle seed

**Files:**
- Create: `apps-script/src/14_custom_bundles.js`
- Modify: `apps-script/src/01_setup.js` (`seedBundlesIfPossible_` seeds the reserved Custom bundle too)
- Test: `apps-script/src/99_dev.js` (`devTestCustomBundleHelpers`)

- [ ] **Step 1: Write the failing test**

Add to `apps-script/src/99_dev.js`:

```javascript
/**
 * Locks the custom-bundle helpers: pref round-trip, palette/label validation,
 * effective-bundle merge (personal overlays reserved defaults), and the
 * project-wide pref scan used by the dashboard. Cleans up its own prefs.
 */
function devTestCustomBundleHelpers() {
  const checks = [];
  const check = (label, ok) => { checks.push({ label, ok }); };
  const email = 'custom.probe@orono.k12.mn.us';
  const projectId = 'devtest-custom-' + uuid_().slice(0, 8);
  try {
    // Seed/find the reserved row.
    const row = seedCustomBundleIfMissing_();
    check('reserved row is custom', isCustomBundle_(row));
    check('reserved has 5 default labels', !!row.label1 && !!row.label5);

    // Round-trip a personal bundle.
    const saved = setCustomBundle_(email, projectId, {
      labels: ['Causes', 'Evidence', 'People', 'Effects', 'Context'],
      colors: PRESET_PALETTE.slice(0, 5),
    });
    check('save returns 5 labels', saved.labels.length === 5);
    const read = getCustomBundle_(email, projectId);
    check('read matches', read && read.labels[1] === 'Evidence' && read.colors[0] === PRESET_PALETTE[0]);

    // Effective bundle = personal over defaults.
    const eff = effectiveCustomBundle_(row, read);
    check('effective custom flag', eff.custom === true);
    check('effective label from personal', eff.label2 === 'Evidence');
    check('effective unset slot falls back', effectiveCustomBundle_(row, null).label1 === row.label1);

    // Validation rejects off-palette + duplicate non-empty labels + wrong count.
    let v1 = false, v2 = false, v3 = false;
    try { validateCustomBundlePayload_({ labels: ['a','b','c','d','e'], colors: ['#000000', PRESET_PALETTE[1], PRESET_PALETTE[2], PRESET_PALETTE[3], PRESET_PALETTE[4]] }); } catch (e) { v1 = true; }
    try { validateCustomBundlePayload_({ labels: ['x','x','c','d','e'], colors: PRESET_PALETTE.slice(0,5) }); } catch (e) { v2 = true; }
    try { validateCustomBundlePayload_({ labels: ['a','b','c'], colors: PRESET_PALETTE.slice(0,5) }); } catch (e) { v3 = true; }
    check('off-palette rejected', v1);
    check('duplicate labels rejected', v2);
    check('wrong count rejected', v3);

    // Project-wide scan keys by email.
    const map = getCustomBundlesForProject_(projectId);
    check('scan finds the email', !!map[email] && map[email].labels[2] === 'People');
    check('scan excludes other projects', !map[email + 'x']);
  } finally {
    setUserPref_(email, 'customBundle:' + projectId, ''); // delete
  }
  const pass = checks.every((c) => c.ok);
  console.log(JSON.stringify({ ok: pass, checks }, null, 2));
  return { ok: pass };
}
```

- [ ] **Step 2: Run to verify it fails**

`clasp push -f`, run `devTestCustomBundleHelpers`. Expected: FAIL — `seedCustomBundleIfMissing_ is not defined`.

- [ ] **Step 3: Create the helpers**

Create `apps-script/src/14_custom_bundles.js`:

```javascript
/**
 * Custom (student-defined) highlight bundles.
 *
 * A custom project references ONE reserved "Custom" bundle row (custom=TRUE)
 * whose label1..5/color1..5 are neutral placeholders. Each student overrides
 * them with their own (labels, colors), stored per (student, project) in
 * ScriptProperties via the user-pref mechanism. The dashboard reads every
 * student's set in one getProperties() scan.
 */

const CUSTOM_DEFAULT_COLORS = ['#F4B400', '#DB4437', '#0F9D58', '#4285F4', '#AB47BC'];
const CUSTOM_DEFAULT_LABELS = ['Category 1', 'Category 2', 'Category 3', 'Category 4', 'Category 5'];

function isCustomBundle_(b) {
  return !!b && (b.custom === true || String(b.custom).toLowerCase() === 'true');
}

function getCustomBundleRow_() {
  return listBundles_().find(isCustomBundle_) || null;
}

/** Idempotent seed of the single reserved Custom bundle. */
function seedCustomBundleIfMissing_() {
  const existing = getCustomBundleRow_();
  if (existing) return existing;
  const bundle = {
    bundleId: uuid_(),
    name: 'Custom — student-defined',
    style: 'mla',
    label1: CUSTOM_DEFAULT_LABELS[0], label2: CUSTOM_DEFAULT_LABELS[1], label3: CUSTOM_DEFAULT_LABELS[2],
    label4: CUSTOM_DEFAULT_LABELS[3], label5: CUSTOM_DEFAULT_LABELS[4],
    color1: CUSTOM_DEFAULT_COLORS[0], color2: CUSTOM_DEFAULT_COLORS[1], color3: CUSTOM_DEFAULT_COLORS[2],
    color4: CUSTOM_DEFAULT_COLORS[3], color5: CUSTOM_DEFAULT_COLORS[4],
    createdBy: CONFIG.OWNER_EMAIL || Session.getEffectiveUser().getEmail(),
    createdAt: nowIso_(),
    custom: true,
  };
  const ss = SpreadsheetApp.openById(CONFIG.BUNDLES_SHEET_ID);
  appendRow_(getTab_(ss, TABS.BUNDLES), HEADERS.BUNDLES, bundle);
  return bundle;
}

function customBundlePrefKey_(projectId) { return 'customBundle:' + projectId; }

/** The active user's stored personal bundle for a custom project, or null. */
function getCustomBundle_(actorEmail, projectId) {
  const raw = getUserPref_(actorEmail, customBundlePrefKey_(projectId));
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (!o || !Array.isArray(o.labels) || !Array.isArray(o.colors)) return null;
    return { labels: o.labels.slice(0, 5), colors: o.colors.slice(0, 5) };
  } catch (e) { return null; }
}

/** Validate + persist a student's personal bundle. Returns the normalized value. */
function setCustomBundle_(actorEmail, projectId, payload) {
  const v = validateCustomBundlePayload_(payload);
  setUserPref_(actorEmail, customBundlePrefKey_(projectId), JSON.stringify(v));
  return v;
}

/** labels: 5 strings (empty allowed; non-empty must be distinct).
 *  colors: 5 hexes, all ∈ PRESET_PALETTE. */
function validateCustomBundlePayload_(payload) {
  if (!payload) throw new Error('payload required');
  const labels = Array.isArray(payload.labels) ? payload.labels.map((l) => String(l == null ? '' : l).trim()) : [];
  const colors = Array.isArray(payload.colors) ? payload.colors.map((c) => String(c == null ? '' : c).trim()) : [];
  if (labels.length !== 5) throw new Error('Exactly 5 labels required');
  if (colors.length !== 5) throw new Error('Exactly 5 colors required');
  const palette = {};
  PRESET_PALETTE.forEach((p) => { palette[p] = true; });
  if (colors.some((c) => !palette[c])) throw new Error('All colors must come from the preset palette');
  const named = labels.filter((l) => l.length > 0);
  const distinct = {};
  named.forEach((l) => { distinct[l] = true; });
  if (Object.keys(distinct).length !== named.length) throw new Error('Category names must be distinct');
  return { labels, colors };
}

/** Effective bundle for a student: personal choices overlay the reserved
 *  row's placeholder labels/colors. Shape matches a normal bundle + custom:true. */
function effectiveCustomBundle_(customRow, personal) {
  const labels = (personal && personal.labels) || [];
  const colors = (personal && personal.colors) || [];
  const out = {
    bundleId: customRow.bundleId,
    name: customRow.name,
    style: customRow.style || 'mla',
    custom: true,
    createdBy: customRow.createdBy,
    createdAt: customRow.createdAt,
  };
  for (let i = 0; i < 5; i++) {
    const lab = (labels[i] && String(labels[i]).trim()) || customRow['label' + (i + 1)] || CUSTOM_DEFAULT_LABELS[i];
    const col = (colors[i] && String(colors[i]).trim()) || customRow['color' + (i + 1)] || CUSTOM_DEFAULT_COLORS[i];
    out['label' + (i + 1)] = lab;
    out['color' + (i + 1)] = col;
  }
  return out;
}

/** {emailLower → {labels, colors}} for every student who set a personal bundle
 *  on this project. One getProperties() scan; used by the dashboard. */
function getCustomBundlesForProject_(projectId) {
  const all = PropertiesService.getScriptProperties().getProperties();
  const suffix = ':' + customBundlePrefKey_(projectId); // ':customBundle:<projectId>'
  const out = {};
  Object.keys(all).forEach((k) => {
    if (k.indexOf(PREFS_PREFIX) !== 0) return;
    const idx = k.indexOf(suffix);
    if (idx < 0 || (idx + suffix.length) !== k.length) return;
    const emailLower = k.slice(PREFS_PREFIX.length, idx);
    try {
      const o = JSON.parse(all[k]);
      if (o && Array.isArray(o.labels) && Array.isArray(o.colors)) out[emailLower] = { labels: o.labels, colors: o.colors };
    } catch (e) { /* skip malformed */ }
  });
  return out;
}
```

- [ ] **Step 4: Wire the seed into setup**

In `apps-script/src/01_setup.js` `seedBundlesIfPossible_` ([`:96`](../../apps-script/src/01_setup.js)), seed the Custom bundle alongside History Day:

```javascript
function seedBundlesIfPossible_(bundlesId) {
  const prev = CONFIG.BUNDLES_SHEET_ID;
  CONFIG.BUNDLES_SHEET_ID = bundlesId; // temporary, so listBundles_/createBundle_ work
  try {
    seedHistoryDayBundleIfMissing_();
    seedCustomBundleIfMissing_();
  } finally {
    CONFIG.BUNDLES_SHEET_ID = prev;
  }
}
```

- [ ] **Step 5: Run to verify it passes**

`clasp push -f`, then run `seedCustomBundleIfMissing_` once from the editor (seeds the row into the live Bundles sheet), then run `devTestCustomBundleHelpers`.
Expected: PASS — all checks `ok: true`. Re-running `seedCustomBundleIfMissing_` returns the same row (idempotent — confirm only one `custom`-flagged row exists in the Bundles sheet).

- [ ] **Step 6: Commit**

```powershell
cd C:\Users\paul.ivers\Desktop\ops-research-tool
git add apps-script/src/14_custom_bundles.js apps-script/src/01_setup.js apps-script/src/99_dev.js
git commit -m "feat(bundles): reserved Custom bundle + per-student custom-bundle helpers"
```

---

### Task B3: `customBundle` GET + `saveCustomBundle` POST endpoints

**Files:**
- Modify: `apps-script/src/30_endpoints.js` (`handleGet_` switch, `handlePost_` action special-case)
- Test: `apps-script/src/99_dev.js` (`devTestCustomBundleEndpoints`)

- [ ] **Step 1: Write the failing test**

Add to `apps-script/src/99_dev.js`:

```javascript
/**
 * Exercises the customBundle GET + saveCustomBundle POST through the real
 * dispatchers (handleGet_/handlePost_) under the caller's identity. Requires a
 * custom project to exist; creates a throwaway one on the reserved bundle.
 */
function devTestCustomBundleEndpoints() {
  const checks = [];
  const check = (label, ok) => { checks.push({ label, ok }); };
  const me = getActorEmail_();
  const customRow = seedCustomBundleIfMissing_();
  // Throwaway custom project.
  const project = createProject_({
    name: 'devtest-custom-ep ' + uuid_().slice(0, 6),
    schoolYear: 'dev-yy', bundleId: customRow.bundleId, memberClasses: ['DEV'], createdBy: me,
  });
  try {
    // POST save.
    const postResp = handlePost_({ postData: { contents: JSON.stringify({
      action: 'saveCustomBundle', projectId: project.projectId,
      labels: ['One', 'Two', 'Three', 'Four', 'Five'], colors: PRESET_PALETTE.slice(0, 5),
    }) } });
    check('post ok', postResp.ok === true);

    // GET read.
    const getResp = handleGet_({ parameter: { action: 'customBundle', projectId: project.projectId } });
    check('get ok', getResp.ok === true);
    check('get returns saved labels', getResp.customBundle && getResp.customBundle.labels[0] === 'One');

    // Reject save on a non-custom project.
    const hd = listBundles_().find((b) => b.name === 'History Day');
    const np = createProject_({ name: 'devtest-noncustom ' + uuid_().slice(0, 6), schoolYear: 'dev-yy', bundleId: hd.bundleId, memberClasses: ['DEV'], createdBy: me });
    const bad = handlePost_({ postData: { contents: JSON.stringify({ action: 'saveCustomBundle', projectId: np.projectId, labels: ['a','b','c','d','e'], colors: PRESET_PALETTE.slice(0,5) }) } });
    check('non-custom project rejected', bad.ok === false);
    archiveProject_(np.projectId);
  } finally {
    setUserPref_(me, 'customBundle:' + project.projectId, '');
    archiveProject_(project.projectId);
  }
  const pass = checks.every((c) => c.ok);
  console.log(JSON.stringify({ ok: pass, checks }, null, 2));
  return { ok: pass };
}
```

- [ ] **Step 2: Run to verify it fails**

`clasp push -f`, run `devTestCustomBundleEndpoints`. Expected: FAIL — `get ok` false (`Unknown action customBundle`) / `post ok` false.

- [ ] **Step 3: Add the GET case**

In `handleGet_` ([`30_endpoints.js:122`](../../apps-script/src/30_endpoints.js)) add before `default:`:

```javascript
      case 'customBundle': {
        if (!params.projectId) throw new Error('projectId required');
        const project = getProject_(params.projectId);
        if (!project) throw new Error('Unknown project ' + params.projectId);
        return { ok: true, customBundle: getCustomBundle_(actorEmail, params.projectId) };
      }
```

- [ ] **Step 4: Add the POST action**

In `handlePost_` ([`30_endpoints.js:33`](../../apps-script/src/30_endpoints.js)) add immediately after the `setActiveProject` block:

```javascript
    if (body.action === 'saveCustomBundle') {
      if (!body.projectId) throw new Error('projectId required');
      const proj = getProject_(body.projectId);
      if (!proj) throw new Error('Unknown projectId ' + body.projectId);
      if (!isCustomBundle_(getBundle_(proj.bundleId))) throw new Error('Project is not a custom-bundle project');
      const saved = setCustomBundle_(actorEmail, body.projectId, { labels: body.labels, colors: body.colors });
      return { ok: true, customBundle: saved };
    }
```

- [ ] **Step 5: Run to verify it passes**

`clasp push -f`, run `devTestCustomBundleEndpoints`. Expected: PASS — all checks `ok: true`.

- [ ] **Step 6: Commit**

```powershell
git add apps-script/src/30_endpoints.js apps-script/src/99_dev.js
git commit -m "feat(api): customBundle GET + saveCustomBundle POST endpoints"
```

---

### Task B4: Persist `categorySlot` on highlights

**Files:**
- Modify: `apps-script/src/20_writes.js` (`upsertHighlight_`)
- Test: `apps-script/src/99_dev.js` (`devTestHighlightCategorySlotRoundTrip`)

- [ ] **Step 1: Write the failing test**

Add to `apps-script/src/99_dev.js`:

```javascript
/** A highlight written with categorySlot reads it back; blank when omitted. */
function devTestHighlightCategorySlotRoundTrip() {
  const checks = [];
  const check = (label, ok) => { checks.push({ label, ok }); };
  const dev = devSeedDevProject();
  const me = getActorEmail_();
  const sheet = findOrCreateStudentSheet_(me, dev);
  upsertSource_(sheet, { sourceId: 'slot-src', projectId: dev.projectId, normalizedUrl: 'https://example.com/slot', rawUrl: 'https://example.com/slot', accessDate: nowIso_(), scrapedTitle: 'Slot probe', sourceType: 'website', createdByEmail: me, createdAt: nowIso_() });
  upsertHighlight_(sheet, { highlightId: 'slot-hl-1', sourceId: 'slot-src', projectId: dev.projectId, primaryCategory: 'Causes', highlightedText: 'with slot', categorySlot: 3, createdByEmail: me, createdAt: nowIso_() });
  upsertHighlight_(sheet, { highlightId: 'slot-hl-2', sourceId: 'slot-src', projectId: dev.projectId, primaryCategory: 'Background', highlightedText: 'no slot', createdByEmail: me, createdAt: nowIso_() });

  const rows = readAllAsObjects_(getTab_(sheet, TABS.HIGHLIGHTS), HEADERS.HIGHLIGHTS);
  const a = rows.find((r) => r.highlightId === 'slot-hl-1');
  const b = rows.find((r) => r.highlightId === 'slot-hl-2');
  check('slot stored as 3', String(a.categorySlot) === '3');
  check('blank when omitted', !b.categorySlot || String(b.categorySlot) === '');

  const pass = checks.every((c) => c.ok);
  console.log(JSON.stringify({ ok: pass, checks }, null, 2));
  return { ok: pass };
}
```

- [ ] **Step 2: Run to verify it fails**

`clasp push -f`, run `devTestHighlightCategorySlotRoundTrip`. Expected: FAIL — `slot stored as 3` false (column not written; reads back blank).

- [ ] **Step 3: Add categorySlot to the row**

In `upsertHighlight_` ([`20_writes.js:52`](../../apps-script/src/20_writes.js)) add to the `row` object (after `createdAt`):

```javascript
  const row = {
    highlightId: highlight.highlightId,
    sourceId: highlight.sourceId,
    projectId: highlight.projectId,
    primaryCategory: highlight.primaryCategory,
    secondaryCategory: highlight.secondaryCategory || '',
    highlightedText: highlight.highlightedText,
    note: highlight.note || '',
    createdByEmail: highlight.createdByEmail,
    createdAt: highlight.createdAt || nowIso_(),
    categorySlot: (highlight.categorySlot === 0 || highlight.categorySlot) ? String(highlight.categorySlot) : '',
  };
```

(`doPost` already spreads `...h` onto each highlight, so a client-sent `categorySlot` reaches `upsertHighlight_` unchanged.)

- [ ] **Step 4: Run to verify it passes**

`clasp push -f`, run `devTestHighlightCategorySlotRoundTrip`. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps-script/src/20_writes.js apps-script/src/99_dev.js
git commit -m "feat(writes): persist highlight categorySlot (custom-project category identity)"
```

---

### Task B5: Dashboard aggregation by slot (custom)

**Files:**
- Modify: `apps-script/src/62_aggregator.js` (`formatBundleCategoryMix_`)
- Modify: `apps-script/src/61_console_api.js` (`computeDashboardParallel_`, `computeDashboardSerial_` thread per-student effective bundle)
- Test: `apps-script/src/99_dev.js` (`devTestDashboardCustomBySlot` — pure)

- [ ] **Step 1: Write the failing test (pure)**

Add to `apps-script/src/99_dev.js`:

```javascript
/**
 * Pure: a custom student's category mix is computed BY SLOT using their own
 * effective bundle (labels/colors), independent of another student's choices.
 */
function devTestDashboardCustomBySlot() {
  const checks = [];
  const check = (label, ok) => { checks.push({ label, ok }); };
  const row = seedCustomBundleIfMissing_();

  const stuA = effectiveCustomBundle_(row, { labels: ['Causes','Evidence','People','Effects','Context'], colors: PRESET_PALETTE.slice(0,5) });
  const stuB = effectiveCustomBundle_(row, { labels: ['Who','What','When','Where','Why'], colors: PRESET_PALETTE.slice(3,8) });

  // Highlights carry categorySlot (identity); primaryCategory is just a snapshot.
  const hlA = [{ categorySlot: '1' }, { categorySlot: '1' }, { categorySlot: '3' }];
  const hlB = [{ categorySlot: '2' }, { categorySlot: '5' }];

  const mixA = formatBundleCategoryMix_(hlA, stuA);
  const mixB = formatBundleCategoryMix_(hlB, stuB);

  check('A has 5 slots', mixA.length === 5);
  check('A slot1 label = Causes', mixA[0].label === 'Causes');
  check('A slot1 count = 2', mixA[0].count === 2);
  check('A slot3 count = 1', mixA[2].count === 1);
  check('A slot1 color = palette[0]', mixA[0].color === PRESET_PALETTE[0]);
  check('B slot1 label = Who (per-student)', mixB[0].label === 'Who');
  check('B slot2 count = 1', mixB[1].count === 1);
  check('B slot5 count = 1', mixB[4].count === 1);
  // Non-custom path unchanged: counts by label.
  const normal = { label1:'X', color1:'#111', label2:'Y', color2:'#222' };
  const mixN = formatBundleCategoryMix_([{ primaryCategory:'X' }, { primaryCategory:'X' }], normal);
  check('non-custom counts by label', mixN[0].label === 'X' && mixN[0].count === 2);

  const pass = checks.every((c) => c.ok);
  console.log(JSON.stringify({ ok: pass, checks }, null, 2));
  return { ok: pass };
}
```

- [ ] **Step 2: Run to verify it fails**

`clasp push -f`, run `devTestDashboardCustomBySlot`. Expected: FAIL — custom counts come back 0 (current `formatBundleCategoryMix_` keys on `primaryCategory`, which these highlights lack).

- [ ] **Step 3: Add the custom branch to `formatBundleCategoryMix_`**

Replace `formatBundleCategoryMix_` ([`62_aggregator.js:48`](../../apps-script/src/62_aggregator.js)) with:

```javascript
function formatBundleCategoryMix_(highlights, bundle) {
  if (!bundle) return [];
  const out = [];
  if (isCustomBundle_(bundle)) {
    // Custom projects: identity is the slot (labels differ per student and can
    // be renamed). Count by categorySlot; label/color come from this student's
    // effective bundle.
    const counts = {};
    highlights.forEach((h) => {
      const slot = parseInt(h.categorySlot, 10);
      if (slot >= 1 && slot <= 5) counts[slot] = (counts[slot] || 0) + 1;
    });
    for (let i = 1; i <= 5; i++) {
      out.push({ label: bundle['label' + i] || ('Category ' + i), color: bundle['color' + i] || '#dadce0', count: counts[i] || 0 });
    }
    return out;
  }
  const counts = {};
  highlights.forEach((h) => {
    if (h.primaryCategory) counts[h.primaryCategory] = (counts[h.primaryCategory] || 0) + 1;
  });
  for (let i = 1; i <= 5; i++) {
    const label = bundle['label' + i];
    if (!label) continue;
    out.push({ label, color: bundle['color' + i] || '#dadce0', count: counts[label] || 0 });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

`clasp push -f`, run `devTestDashboardCustomBySlot`. Expected: PASS. Also rerun `devTestDashboardPerfAll` — the parallel/serial parity test must still PASS (non-custom path unchanged).

- [ ] **Step 5: Thread the per-student effective bundle into the dashboard**

In `computeDashboardParallel_` ([`61_console_api.js:344`](../../apps-script/src/61_console_api.js)), right after `const enrolled = dashboardEnrolled_(scopedClasses);`, add:

```javascript
  const customMap = isCustomBundle_(bundle) ? getCustomBundlesForProject_(project.projectId) : null;
  const bundleForStudent_ = (email) => customMap
    ? effectiveCustomBundle_(bundle, customMap[String(email).toLowerCase()] || null)
    : bundle;
```

Change the student aggregation line (`:413`) from `aggregateStudent_(personalSources, personalHighlights, bundle)` to:

```javascript
    const agg = aggregateStudent_(personalSources, personalHighlights, bundleForStudent_(r.Email));
```

Leave the group `aggregateStudent_(fetched.sources, fetched.highlights, bundle)` (`:430`) AS-IS — for custom projects the reserved `bundle` carries placeholder labels/colors, so a group bar renders by slot with "Category N" (custom + groups is deferred; see spec §10).

Apply the identical change in `computeDashboardSerial_` ([`61_console_api.js:457`](../../apps-script/src/61_console_api.js)): add the same two lines after its `const enrolled = ...`, and change its student line (`:480`) to `aggregateStudent_(personalSources, personalHighlights, bundleForStudent_(r.Email))`. Leave its group line unchanged.

- [ ] **Step 6: Run parity again**

`clasp push -f`, run `devTestDashboardPerfAll`. Expected: PASS (the change is a no-op for non-custom projects; both paths got the identical edit so parity holds).

- [ ] **Step 7: Commit**

```powershell
git add apps-script/src/62_aggregator.js apps-script/src/61_console_api.js apps-script/src/99_dev.js
git commit -m "feat(dashboard): aggregate custom-project categories by slot per student"
```

---

### Task B6: Docs sidebar reads the student's effective bundle

**Files:**
- Modify: `apps-script/src/53_sidebar_api.js` (`sidebarGetContext`, `sidebarOpenSourceEditor`)

DOM-adjacent (HtmlService) — verified by real-Doc QA (Step 3) plus the existing `devDiagnoseSidebarData`.

- [ ] **Step 1: Overlay the effective bundle in `sidebarGetContext`**

In `sidebarGetContext` ([`53_sidebar_api.js:34`](../../apps-script/src/53_sidebar_api.js)) replace the `activeBundle` line with:

```javascript
  const activeBundleRow = activeProject ? bundles.find((b) => b.bundleId === activeProject.bundleId) || null : null;
  const activeBundle = (activeBundleRow && isCustomBundle_(activeBundleRow))
    ? effectiveCustomBundle_(activeBundleRow, getCustomBundle_(actorEmail, activeProject.projectId))
    : activeBundleRow;
```

- [ ] **Step 2: Overlay in the source-editor modal**

In `sidebarOpenSourceEditor` ([`53_sidebar_api.js:371`](../../apps-script/src/53_sidebar_api.js)) replace the bundle line with:

```javascript
  const bundleRow = listBundles_().find((b) => b.bundleId === project.bundleId) || null;
  const bundle = (bundleRow && isCustomBundle_(bundleRow))
    ? effectiveCustomBundle_(bundleRow, getCustomBundle_(actorEmail, projectId))
    : bundleRow;
```

(`actorEmail` is already in scope in that function; confirm and reuse it.)

- [ ] **Step 3: Real-Doc QA**

`clasp push -f`, redeploy (see Task B9 Step), open a Doc as a student whose active project is a custom project where they've set categories. Expect the sidebar facets + source-editor swatches to show that student's labels/colors (not "Category N"). A student with no saved set sees the placeholders.

- [ ] **Step 4: Commit**

```powershell
git add apps-script/src/53_sidebar_api.js
git commit -m "feat(docs-sidebar): render the student's effective custom bundle"
```

---

### Task B7: Wizard "Custom" option (console)

**Files:**
- Modify: `apps-script/src/console_js.html` (the bundle `<select>` fill from Stage A)

Stage A's `fill()` already lists every bundle row, so the reserved Custom row already appears by name. This task just makes it legible and adds an explainer.

- [ ] **Step 1: Relabel the custom option + explainer**

In the Stage A bundle-field `fill()` loop (`renderCreateModal_`), give the custom row a friendly label and show a one-line note when selected:

```javascript
      bundles.forEach((b) => {
        const o = document.createElement('option');
        const custom = (b.custom === true || String(b.custom).toLowerCase() === 'true');
        o.value = b.bundleId;
        o.textContent = custom ? '✏️ Custom — students define their own' : b.name;
        if (b.bundleId === fields.bundleId) o.selected = true;
        s.appendChild(o);
      });
```

Add, after the `fields.bundleId = s.value;` line in the select's change handler:

```javascript
        const chosen = bundles.find((b) => b.bundleId === s.value);
        const isCustom = chosen && (chosen.custom === true || String(chosen.custom).toLowerCase() === 'true');
        customNote.style.display = isCustom ? 'block' : 'none';
```

where `customNote` is created once right after `body.appendChild(bundleField);`:

```javascript
  const customNote = document.createElement('div');
  customNote.style.cssText = 'font-size:11px;color:#5f6368;margin:-4px 0 8px;';
  customNote.textContent = 'Students choose their own 5 colors and category names in the research panel.';
  customNote.style.display = 'none';
  body.appendChild(customNote);
```

- [ ] **Step 2: Manual QA**

`clasp push -f`, open the console → New project. Selecting "✏️ Custom — students define their own" shows the explainer; creating the project succeeds with `project.bundleId` = the reserved custom row. Confirm in the Projects registry the new project's `bundleId` matches the custom bundle id.

- [ ] **Step 3: Commit**

```powershell
git add apps-script/src/console_js.html
git commit -m "feat(console): Custom option in the New Project wizard"
```

---

### Task B8: Extension service worker — effective bundle, save handler, slot passthrough

**Files:**
- Modify: `extension/background.js` (`getActiveProjectInfo`, `handleMessage`, `enqueueHighlight`, + helpers)

JS, no GAS test — verified by extension QA in Task B9.

- [ ] **Step 1: Resolve the effective bundle for custom projects**

In `getActiveProjectInfo` ([`background.js:530`](../../extension/background.js)) replace the final bundle resolution + return with:

```javascript
  let bundle = project ? bundles.find((b) => b.bundleId === project.bundleId) || null : null;
  if (project && bundle && isCustomBundleClient_(bundle)) {
    bundle = await resolveEffectiveCustomBundle_(project.projectId, bundle);
  }
  return { ok: true, activeProjectId, project, bundle, projects, projectsKnown: projects.length > 0 };
```

Add these helpers near the bottom of `background.js`:

```javascript
function isCustomBundleClient_(b) {
  return !!b && (b.custom === true || String(b.custom).toLowerCase() === 'true');
}

// Overlay the student's stored personal labels/colors onto the reserved Custom
// row. Cached per project; the cache is refreshed on saveCustomBundle_.
async function resolveEffectiveCustomBundle_(projectId, customRow) {
  let personal = await getCache('cachedCustomBundle:' + projectId);
  if (!personal) {
    try {
      const resp = await apiGet({ action: 'customBundle', projectId });
      personal = (resp && resp.ok && resp.customBundle) ? resp.customBundle : { labels: [], colors: [] };
      await setCache('cachedCustomBundle:' + projectId, personal);
    } catch (e) {
      personal = { labels: [], colors: [] };
    }
  }
  const eff = Object.assign({}, customRow);
  for (let i = 0; i < 5; i++) {
    const lab = personal.labels && personal.labels[i] && String(personal.labels[i]).trim();
    const col = personal.colors && personal.colors[i] && String(personal.colors[i]).trim();
    if (lab) eff['label' + (i + 1)] = lab;
    if (col) eff['color' + (i + 1)] = col;
  }
  return eff;
}

async function saveCustomBundle_(projectId, labels, colors) {
  if (!projectId) throw new Error('projectId required');
  const resp = await apiPost({ action: 'saveCustomBundle', projectId, labels, colors });
  if (resp && resp.ok && resp.customBundle) {
    await setCache('cachedCustomBundle:' + projectId, resp.customBundle);
  }
  return resp;
}
```

- [ ] **Step 2: Add the save message handler**

In `handleMessage` ([`background.js:152`](../../extension/background.js)) add a case:

```javascript
    case 'saveCustomBundle':
      return saveCustomBundle_(msg.projectId, msg.labels, msg.colors);
```

- [ ] **Step 3: Pass categorySlot through the queue**

In `enqueueHighlight` ([`background.js:486`](../../extension/background.js)) add `categorySlot` to the enqueued payload:

```javascript
  await enqueue('highlight', {
    highlightId,
    sourceId: h.sourceId,
    projectId,
    primaryCategory: h.primaryCategory || '',
    secondaryCategory: h.secondaryCategory || '',
    highlightedText: h.highlightedText,
    note: h.note || '',
    categorySlot: (h.categorySlot === 0 || h.categorySlot) ? String(h.categorySlot) : '',
    createdAt: new Date().toISOString(),
  });
```

- [ ] **Step 4: Commit**

```powershell
git add extension/background.js
git commit -m "feat(extension/bg): effective custom bundle, saveCustomBundle, categorySlot passthrough"
```

---

### Task B9: In-page sidebar Categories editor + toolbar slot capture

**Files:**
- Modify: `extension/content/sidebar.js` (Categories editor; slot derivation for custom)
- Modify: `extension/content/toolbar.js` (`draftSlot`; send `categorySlot`)

JS/DOM — verified by extension QA (Step 6). This is the largest UI task; implement in the listed sub-steps.

- [ ] **Step 1: Toolbar — capture the slot**

In `toolbar.js`, add `let draftSlot = null;` beside `draftColor` ([`:32`](../../extension/content/toolbar.js)). In the swatch click handler ([`:220`](../../extension/content/toolbar.js)) record the slot (the loop index `i`):

```javascript
    sw.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (draftCategory === label) {
        draftCategory = null; draftColor = null; draftSlot = null;
      } else {
        draftCategory = label; draftColor = color; draftSlot = i;
      }
      renderToolbar_();
    });
```

Reset `draftSlot = null` everywhere `draftColor` is reset (`hideToolbar`, `showToolbar` fresh-open block). In `commitDraft_` ([`:158`](../../extension/content/toolbar.js)) capture it and pass to `syncHighlight_`/`OpsSidebar.addHighlight`:

```javascript
  const slot = draftSlot;
  ...
  if (self.OpsSidebar) {
    self.OpsSidebar.addHighlight({ highlightId, sourceId: null, primaryCategory: category || '', categorySlot: slot || '', color, text: snapshot.text, note });
  }
  hideToolbar();
  syncHighlight_(highlightId, category || '', snapshot.text, note, slot);
```

In `syncHighlight_` ([`:283`](../../extension/content/toolbar.js)) add the `slot` param and include it in the `enqueueHighlight` message:

```javascript
async function syncHighlight_(highlightId, primaryCategory, text, note, categorySlot) {
  ...
    const hlResp = await chrome.runtime.sendMessage({
      type: 'enqueueHighlight',
      highlight: { highlightId, sourceId: srcResp.sourceId, primaryCategory, categorySlot: categorySlot || '', highlightedText: text, note },
    });
  ...
}
```

- [ ] **Step 2: Sidebar — derive label/color from slot for custom highlights**

In `sidebar.js`, add two helpers next to `colorForLabel_` ([`:1119`](../../extension/content/sidebar.js)):

```javascript
  function isCustomBundle_() {
    return !!state.bundle && (state.bundle.custom === true || String(state.bundle.custom).toLowerCase() === 'true');
  }
  // For custom projects the slot is the identity; label+color come from the
  // current effective bundle. Returns null slot → leaves values untouched.
  function deriveFromSlot_(h) {
    if (!isCustomBundle_() || !state.bundle) return;
    const slot = parseInt(h.categorySlot, 10);
    if (!(slot >= 1 && slot <= 5)) return;
    h.primaryCategory = state.bundle['label' + slot] || ('Category ' + slot);
    h.color = state.bundle['color' + slot] || '#fff8c4';
  }
```

In `loadForCurrentPage` where server highlights are pushed ([`:467-479`](../../extension/content/sidebar.js)), carry `categorySlot` and derive:

```javascript
    resp.highlights.forEach((h) => {
      if (state.pageHighlights.some((x) => x.highlightId === h.highlightId)) return;
      const entry = {
        highlightId: h.highlightId,
        sourceId: h.sourceId,
        primaryCategory: h.primaryCategory,
        secondaryCategory: h.secondaryCategory || '',
        categorySlot: h.categorySlot || '',
        text: h.highlightedText,
        note: h.note || '',
        color: colorForLabel_(h.primaryCategory) || '#fff8c4',
        syncStatus: 'saved',
      };
      deriveFromSlot_(entry);   // custom: overwrite label+color from slot
      state.pageHighlights.push(entry);
    });
```

In `addHighlight` ([`:341`](../../extension/content/sidebar.js)) derive on the freshly-captured entry too:

```javascript
  async function addHighlight(h) {
    await ensureInit_();
    const entry = { ...h, syncStatus: 'pending' };
    deriveFromSlot_(entry);
    state.pageHighlights.push(entry);
    show();
    render_();
  }
```

- [ ] **Step 3: Sidebar — the Categories editor (custom only)**

Add a render function and inject it in `renderPanel_` just after the project selector (`projWrap`), before the tab bar ([`:745`](../../extension/content/sidebar.js)):

```javascript
    if (isCustomBundle_()) state.panelEl.appendChild(renderCategoriesEditor_());
```

Add the function (8-swatch palette per row; debounced save):

```javascript
  const OPS_PALETTE = ['#F4B400','#DB4437','#0F9D58','#4285F4','#AB47BC','#FF7043','#26A69A','#8D6E63'];
  let _catSaveTimer = null;

  function renderCategoriesEditor_() {
    const wrap = el_('div', 'cats');
    wrap.appendChild(el_('div', 'cats__hdr', 'Your categories'));
    for (let i = 1; i <= 5; i++) {
      const row = el_('div', 'cats__row');
      const input = document.createElement('input');
      input.className = 'cats__name';
      input.type = 'text';
      input.placeholder = 'Category ' + i;
      input.value = (state.bundle['label' + i] && state.bundle['label' + i].indexOf('Category ') !== 0) ? state.bundle['label' + i] : '';
      input.addEventListener('input', () => { state.bundle['label' + i] = input.value.trim() || ('Category ' + i); scheduleCatSave_(); });
      row.appendChild(input);
      const swWrap = el_('div', 'cats__sw');
      OPS_PALETTE.forEach((hex) => {
        const sw = el_('button', 'cats__pick');
        sw.type = 'button';
        sw.style.setProperty('background-color', hex, 'important');
        if (state.bundle['color' + i] === hex) sw.classList.add('cats__pick--on');
        sw.addEventListener('click', () => { state.bundle['color' + i] = hex; render_(); scheduleCatSave_(); });
        swWrap.appendChild(sw);
      });
      row.appendChild(swWrap);
      wrap.appendChild(row);
    }
    return wrap;
  }

  function scheduleCatSave_() {
    clearTimeout(_catSaveTimer);
    _catSaveTimer = setTimeout(saveCategories_, 600);
  }
  async function saveCategories_() {
    if (!state.project || !isCustomBundle_()) return;
    const labels = []; const colors = [];
    for (let i = 1; i <= 5; i++) {
      const lab = state.bundle['label' + i] || '';
      labels.push(lab.indexOf('Category ') === 0 ? '' : lab); // store placeholders as empty
      colors.push(state.bundle['color' + i]);
    }
    try {
      await chrome.runtime.sendMessage({ type: 'saveCustomBundle', projectId: state.project.projectId, labels, colors });
    } catch (e) { console.warn('[OPS sidebar] saveCustomBundle failed:', e); }
    // Re-derive every custom highlight's label/color from its slot so renames
    // reflect immediately, then repaint.
    state.pageHighlights.forEach((h) => deriveFromSlot_(h));
    state.pageHighlights.forEach((h) => { if (h.categorySlot) updateMarkColor_(h.highlightId, h.color); });
    render_();
  }
```

Add CSS to `SIDEBAR_CSS` ([`:315`](../../extension/content/sidebar.js), before the closing backtick):

```css
.cats { padding:8px 12px; border-bottom:1px solid #f1f3f4; }
.cats__hdr { font-size:10px; text-transform:uppercase; letter-spacing:0.05em; color:#5f6368; margin-bottom:6px; }
.cats__row { display:flex; align-items:center; gap:6px; margin-bottom:6px; }
.cats__name { flex:1; min-width:0; border:1px solid #dadce0; border-radius:6px; padding:4px 7px; font:inherit; font-size:12px; }
.cats__sw { display:flex; gap:3px; }
.cats__pick { width:16px; height:16px; border-radius:50%; border:2px solid transparent; padding:0; background-clip:padding-box; }
.cats__pick--on { border-color:#202124; }
```

- [ ] **Step 4: Make the swatch editor + facets slot-aware on category change**

In `renderEditor_` primary-category swatch click ([`:1233`](../../extension/content/sidebar.js)), set the slot when custom so an edited category writes the right identity:

```javascript
        sw.addEventListener('click', () => {
          h.primaryCategory = label;
          h.color = color;
          if (isCustomBundle_()) h.categorySlot = String(i);
          updateMarkColor_(h.highlightId, color);
          enqueueUpdate_(h);
          render_();
        });
```

And include `categorySlot` in `enqueueUpdate_`'s message ([`:1383`](../../extension/content/sidebar.js)):

```javascript
      highlight: {
        highlightId: h.highlightId,
        sourceId: h.sourceId,
        primaryCategory: h.primaryCategory,
        secondaryCategory: h.secondaryCategory || '',
        categorySlot: h.categorySlot || '',
        highlightedText: h.text,
        note: h.note || '',
      },
```

(The facet list at `:991` already iterates slots 1–5 reading `state.bundle['label'+i]`/`['color'+i]`, so for custom it shows the student's names automatically. `countByCategory_`/`filteredHighlights_` work on the slot-derived `primaryCategory`, which is kept consistent by `deriveFromSlot_`. Distinct labels are enforced server-side in `validateCustomBundlePayload_`.)

- [ ] **Step 5: Re-derive after a project switch / context reload**

In `switchProject_` ([`:639`](../../extension/content/sidebar.js)) after `await loadContext_();` add nothing extra (page state is cleared), and in `show()`/`loadContext_` paths the next `loadForCurrentPage` derives. No change needed beyond Steps 2–4.

- [ ] **Step 6: Load-unpacked QA**

Build: in Chrome → Extensions → Load unpacked → `extension/`. As a student in a **custom** project:
1. Open the sidebar → the "Your categories" editor shows 5 rows with palette pickers; names blank, default colors.
2. Name a few categories + pick colors → toolbar swatches and facet rows reflect them within ~0.6s; reload the page → names/colors persist (server round-trip).
3. Highlight text using a colored swatch → the entry + on-page mark use that color; the dashboard (teacher console) shows the highlight under the matching slot with your label.
4. Rename a category that already has highlights → existing entries' labels/colors update live (slot identity), no orphaned "(uncategorized)".
5. Switch to a non-custom project → the categories editor disappears; behavior is exactly as before.

- [ ] **Step 7: Commit**

```powershell
git add extension/content/sidebar.js extension/content/toolbar.js
git commit -m "feat(extension): in-page Categories editor + slot-based custom highlights"
```

---

### Task B10: Redeploy, seed, and document

- [ ] **Step 1: Seed the reserved bundle in production + redeploy**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\Users\paul.ivers\Desktop\ops-research-tool\apps-script
clasp push -f
```
Run `seedCustomBundleIfMissing_` once from the editor (idempotent). Then redeploy the Web App:
```powershell
clasp deploy -i AKfycbwaWJe2cbmS3C0-HeKVI_Q0vALI8Jq-ivNZTcFZT_UuHHvBdBxSN0nwCwTpQrOI8FA -d "stage B: custom student-defined bundles"
```

- [ ] **Step 2: Update CLAUDE.md** — §3 (Phase 2/4 surfaces), §4 (replace the "Custom highlighter bundles are backend-only" note with the shipped three-path picker; document the reserved Custom bundle, `prefs:<email>:customBundle:<projectId>`, the `categorySlot` column, slot-based dashboard aggregation, and the deferred custom+groups limitation), §6/§8 (new `devTest*`: `devTestCustomBundleHelpers`, `devTestCustomBundleEndpoints`, `devTestHighlightCategorySlotRoundTrip`, `devTestDashboardCustomBySlot`). Commit.

- [ ] **Step 3: Run the full guard suite** — from the editor: `devTestRoundTrip`, `devTestGroupsAll`, `devTestDashboardPerfAll`, and the four new custom tests. All green.

## Self-review notes (Stage B)
- **Spec coverage:** §3.1 reserved bundle (B2) · §3.2 per-student pref + scan (B2) · §3.3 categorySlot + slot derivation (B1/B4/B9) · §4.1 endpoints (B3) · §4.2 dashboard by slot (B5) · §5.1 effective bundle in extension (B8) · §5.2 toolbar slot (B9) · §5.3 Categories editor (B9) · §6 Docs sidebar read (B6) · §7 wizard Custom option (B7) · §8 schema (B1) · §10 deferral honored (B5 leaves group path on placeholders) · §11 tests (B2/B3/B4/B5). §5.4 popup hint intentionally dropped (no existing popup preview; YAGNI).
- **Type consistency:** `effectiveCustomBundle_(customRow, personal|null)` and `getCustomBundle_→{labels,colors}` used identically across B2/B5/B6/B8. `categorySlot` is always a string ('1'..'5' or '') from `upsertHighlight_`, `enqueueHighlight`, `deriveFromSlot_`. `isCustomBundle_` (server) / `isCustomBundleClient_` (extension) are deliberately separate (different runtimes, same predicate).
- **No placeholders:** every code step shows complete code; DOM tasks carry explicit manual-QA acceptance steps.
- **Distinct-label invariant** (server-enforced in `validateCustomBundlePayload_`) is what lets the label-based facet/filter code keep working on slot-derived labels — do not relax it without making the facet code slot-keyed.
