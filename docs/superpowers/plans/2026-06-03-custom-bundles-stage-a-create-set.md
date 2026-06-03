# Custom Highlight Bundles — Stage A: Create-a-new-set — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a teacher author a reusable 5-category highlighter bundle inline in the New Project wizard, persisted to the shared Bundles registry.

**Architecture:** Thin server endpoint `consoleCreateBundle` wraps the existing, already-validated `createBundle_`. The wizard's bundle `<select>` gains a "➕ Create new set…" sentinel that reveals a 5-row sub-form (name + an 8-swatch palette picker per row); on save it creates the bundle, then selects it for the project. No schema changes.

**Tech Stack:** Google Apps Script (V8), vanilla-JS HtmlService console (`console_js.html`), `google.script.run` RPC.

**Spec:** [`docs/superpowers/specs/2026-06-03-custom-highlight-bundles-design.md`](../specs/2026-06-03-custom-highlight-bundles-design.md) §1, §4.1, §7, §9 (Stage A).

**Reference facts (already in the codebase):**
- `createBundle_({name, style, labels, colors, createdBy})` — [`13_bundles.js:16`](../../apps-script/src/13_bundles.js) — throws unless exactly 5 non-empty labels + exactly 5 colors all ∈ `PRESET_PALETTE` + `style ∈ CITATION_STYLES`. Returns the stored bundle row `{bundleId, name, style, label1..5, color1..5, createdBy, createdAt}`.
- `PRESET_PALETTE` — [`13_bundles.js:41`](../../apps-script/src/13_bundles.js) — 8 hexes: `#F4B400 #DB4437 #0F9D58 #4285F4 #AB47BC #FF7043 #26A69A #8D6E63`.
- `assertStaff_(actorEmail)` — [`61_console_api.js:63`](../../apps-script/src/61_console_api.js) — throws "Not authorized" for non-staff.
- `listBundlesForConsole()` — [`61_console_api.js:534`](../../apps-script/src/61_console_api.js) — currently `return { ok: true, bundles: listBundles_() };`.
- Wizard bundle field — [`console_js.html:447-458`](../../apps-script/src/console_js.html) inside `renderCreateModal_(fields, bundles, classOptions)`; the modal is opened by `openCreateProjectModal_()` ([`console_js.html:352`](../../apps-script/src/console_js.html)), which fetches bundles via `listBundlesForConsole()`.

**How to push + test in this repo (every "Run" step):**
```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\Users\paul.ivers\Desktop\ops-research-tool\apps-script
clasp push -f
```
`clasp run` is NOT available on this project (default GCP project; see CLAUDE.md §4). Run `devTest*` from the Apps Script editor: `clasp open` → select the function in the toolbar → **Run** → read the **Execution log**. A green test prints `{"ok": true, ...}`.

---

### Task A1: `consoleCreateBundle` server endpoint

**Files:**
- Modify: `apps-script/src/61_console_api.js` (add `consoleCreateBundle`; extend `listBundlesForConsole` to also return the palette)
- Test: `apps-script/src/99_dev.js` (add `devTestConsoleCreateBundle` + `devDeleteBundleRow_` teardown helper)

- [ ] **Step 1: Write the failing test**

Add to `apps-script/src/99_dev.js` (anywhere among the other `devTest*`):

```javascript
/**
 * Test-only teardown: hard-delete a Bundles registry row by id. Bundles are
 * production-immutable (no deleter ships), so this lives in 99_dev.js purely so
 * devTestConsoleCreateBundle doesn't pollute the real picker with test sets.
 */
function devDeleteBundleRow_(bundleId) {
  const ss = SpreadsheetApp.openById(CONFIG.BUNDLES_SHEET_ID);
  const tab = getTab_(ss, TABS.BUNDLES);
  const idCol = HEADERS.BUNDLES.indexOf('bundleId') + 1;
  const last = tab.getLastRow();
  for (let r = last; r >= 2; r--) {
    if (String(tab.getRange(r, idCol).getValue()) === String(bundleId)) {
      tab.deleteRow(r);
      return true;
    }
  }
  return false;
}

/**
 * Locks consoleCreateBundle: staff-gated wrapper over createBundle_ that
 * persists a reusable bundle; off-palette colors and wrong label counts are
 * rejected by the underlying validator.
 */
function devTestConsoleCreateBundle() {
  const checks = [];
  const created = [];
  const check = (label, ok) => { checks.push({ label, ok }); };
  const name = 'devtest set ' + uuid_().slice(0, 8);
  try {
    const resp = consoleCreateBundle({
      name, style: 'mla',
      labels: ['Aa', 'Bb', 'Cc', 'Dd', 'Ee'],
      colors: PRESET_PALETTE.slice(0, 5),
    });
    if (resp && resp.bundle && resp.bundle.bundleId) created.push(resp.bundle.bundleId);
    check('ok true', resp && resp.ok === true);
    check('bundle has id', !!(resp.bundle && resp.bundle.bundleId));
    check('persisted + readable', !!getBundle_(resp.bundle.bundleId));
    check('label1 stored', resp.bundle.label1 === 'Aa');
    check('color5 stored', resp.bundle.color5 === PRESET_PALETTE[4]);

    let threwColor = false;
    try {
      const r = consoleCreateBundle({ name: name + '-x', labels: ['Aa','Bb','Cc','Dd','Ee'],
        colors: ['#000000', PRESET_PALETTE[1], PRESET_PALETTE[2], PRESET_PALETTE[3], PRESET_PALETTE[4]] });
      if (r && r.bundle) created.push(r.bundle.bundleId);
    } catch (e) { threwColor = true; }
    check('off-palette color rejected', threwColor);

    let threwLabels = false;
    try {
      const r = consoleCreateBundle({ name: name + '-y', labels: ['Aa','Bb','Cc'], colors: PRESET_PALETTE.slice(0, 5) });
      if (r && r.bundle) created.push(r.bundle.bundleId);
    } catch (e) { threwLabels = true; }
    check('wrong label count rejected', threwLabels);
  } finally {
    created.forEach((id) => { try { devDeleteBundleRow_(id); } catch (e) {} });
  }
  const pass = checks.every((c) => c.ok);
  console.log(JSON.stringify({ ok: pass, checks }, null, 2));
  return { ok: pass };
}
```

- [ ] **Step 2: Run test to verify it fails**

`clasp push -f`, then run `devTestConsoleCreateBundle` from the editor.
Expected: FAIL — execution error `ReferenceError: consoleCreateBundle is not defined`.

- [ ] **Step 3: Write minimal implementation**

Add to `apps-script/src/61_console_api.js` (next to `consoleCreateProject`):

```javascript
/**
 * Create a reusable category bundle from the Console wizard's "Create new set"
 * sub-form. Staff-gated. Thin wrapper over createBundle_, which enforces exactly
 * 5 non-empty labels + 5 colors drawn from PRESET_PALETTE + a valid style.
 * Returns { ok, bundle }.
 */
function consoleCreateBundle(args) {
  const actorEmail = getActorEmail_();
  assertStaff_(actorEmail);
  if (!args) throw new Error('args required');
  const name = String(args.name || '').trim();
  if (!name || name.length > 60) throw new Error('Set name must be 1–60 characters');
  const labels = Array.isArray(args.labels) ? args.labels.map((l) => String(l == null ? '' : l).trim()) : [];
  const colors = Array.isArray(args.colors) ? args.colors.map((c) => String(c == null ? '' : c).trim()) : [];
  const style = String(args.style || 'mla').trim() || 'mla';
  const bundle = createBundle_({ name, style, labels, colors, createdBy: actorEmail });
  return { ok: true, bundle };
}
```

Then extend `listBundlesForConsole` so the client gets the palette for the sub-form. Replace its body (`61_console_api.js:534`):

```javascript
function listBundlesForConsole() {
  assertStaff_(getActorEmail_());
  return { ok: true, bundles: listBundles_(), palette: PRESET_PALETTE };
}
```

(Confirm the exact current body first; it asserts staff then returns `{ ok, bundles }`. Keep the existing assert.)

- [ ] **Step 4: Run test to verify it passes**

`clasp push -f`, then run `devTestConsoleCreateBundle`.
Expected: PASS — log shows `{"ok": true, ...}` and all 7 checks `ok: true`. The registry has no leftover `devtest set …` rows (teardown ran).

- [ ] **Step 5: Commit**

```powershell
cd C:\Users\paul.ivers\Desktop\ops-research-tool
git add apps-script/src/61_console_api.js apps-script/src/99_dev.js
git commit -m "feat(console): consoleCreateBundle endpoint for teacher-authored bundles"
```

---

### Task A2: Wizard "Create new set" sub-form

**Files:**
- Modify: `apps-script/src/console_js.html` — `openCreateProjectModal_` (capture palette), `renderCreateModal_` (bundle field rework + sub-form)

This is a DOM/HtmlService task — no `devTest`. Verification is manual QA in the live console (Step 4).

- [ ] **Step 1: Thread the palette into the modal**

In `openCreateProjectModal_` ([`console_js.html:364-386`](../../apps-script/src/console_js.html)), the success handler receives `bundlesResp`. Capture the palette and pass it to `renderCreateModal_`. Change both `renderCreateModal_(fields, bundles, classes)` / `renderCreateModal_(fields, bundles, state.ctx.teacherClasses || [])` calls to pass the palette as a 4th arg:

```javascript
    .withSuccessHandler((bundlesResp) => {
      const bundles = bundlesResp && bundlesResp.bundles ? bundlesResp.bundles : [];
      const palette = (bundlesResp && bundlesResp.palette) ? bundlesResp.palette : [];
      if (bundles.length === 0) {
        setStatus('No bundles available.', 'bad', 3000);
        return;
      }
      fields.bundleId = bundles[0].bundleId;

      if (state.ctx.role === 'admin') {
        google.script.run
          .withSuccessHandler((clsResp) => {
            const classes = (clsResp && clsResp.classes) ? clsResp.classes : [];
            renderCreateModal_(fields, bundles, classes, palette);
          })
          .withFailureHandler(onFail_('loading classes'))
          .consoleListAllClasses();
      } else {
        renderCreateModal_(fields, bundles, state.ctx.teacherClasses || [], palette);
      }
    })
```

Update the `renderCreateModal_` signature to `function renderCreateModal_(fields, bundles, classOptions, palette)`.

- [ ] **Step 2: Replace the bundle field with a select + sentinel + sub-form**

Replace the `// Bundle` block (`console_js.html:447-458`) with:

```javascript
  // Bundle — real bundles + a "Create new set…" sentinel that reveals a
  // 5-row authoring sub-form. `bundles` is mutated in place when a set is
  // created so the picker reflects it without a full reload.
  const CREATE_SENTINEL = '__create_new_set__';
  const bundleField = makeField_('Bundle', (() => {
    const s = document.createElement('select');
    s.id = 'create-bundle-select';
    const fill = () => {
      s.innerHTML = '';
      bundles.forEach((b) => {
        const o = document.createElement('option');
        o.value = b.bundleId; o.textContent = b.name;
        if (b.bundleId === fields.bundleId) o.selected = true;
        s.appendChild(o);
      });
      const sep = document.createElement('option');
      sep.value = CREATE_SENTINEL; sep.textContent = '➕ Create new set…';
      s.appendChild(sep);
    };
    fill();
    s.addEventListener('change', () => {
      if (s.value === CREATE_SENTINEL) {
        s.value = fields.bundleId;            // don't leave the sentinel selected
        toggleCreateSetForm_(true);
      } else {
        fields.bundleId = s.value;
        toggleCreateSetForm_(false);
      }
    });
    s._fill = fill;                           // re-fill hook used after creating a set
    return s;
  })());
  body.appendChild(bundleField);

  // The create-set sub-form (hidden until the sentinel is chosen).
  const setForm = buildCreateSetForm_(fields, bundles, palette, () => {
    const sel = document.getElementById('create-bundle-select');
    if (sel && sel._fill) sel._fill();        // refresh options
    updateCreateBtn_();
  });
  body.appendChild(setForm);

  function toggleCreateSetForm_(show) {
    setForm.style.display = show ? 'block' : 'none';
  }
```

- [ ] **Step 3: Add the sub-form builder**

Add these helpers in `console_js.html` (near `renderCreateModal_`):

```javascript
// 5-row "create a new set" authoring form. Each row: a name input + an
// 8-swatch palette picker (one selected). On Save, calls consoleCreateBundle,
// pushes the result into `bundles`, selects it, and hides the form.
function buildCreateSetForm_(fields, bundles, palette, onCreated) {
  const wrap = document.createElement('div');
  wrap.className = 'modal__field';
  wrap.style.display = 'none';
  wrap.style.borderTop = '1px dashed #c9cdd6';
  wrap.style.paddingTop = '10px';

  const lab = document.createElement('label');
  lab.textContent = 'New set';
  wrap.appendChild(lab);

  const nameInput = document.createElement('input');
  nameInput.type = 'text'; nameInput.maxLength = 60; nameInput.placeholder = 'Set name (e.g., Capstone categories)';
  nameInput.style.marginBottom = '8px';
  wrap.appendChild(nameInput);

  // Per-row chosen color, defaulting to the first 5 distinct palette colors.
  const rowColors = palette.slice(0, 5);
  const rowInputs = [];
  for (let i = 0; i < 5; i++) {
    const row = document.createElement('div');
    row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '6px'; row.style.marginBottom = '6px';

    const li = document.createElement('input');
    li.type = 'text'; li.maxLength = 40; li.placeholder = 'Category ' + (i + 1) + ' name';
    li.style.flex = '1';
    rowInputs.push(li);
    row.appendChild(li);

    palette.forEach((hex) => {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.style.cssText = 'width:20px;height:20px;border-radius:50%;padding:0;border:2px solid transparent;background:' + hex + ';';
      if (hex === rowColors[i]) sw.style.borderColor = '#202124';
      sw.addEventListener('click', () => {
        rowColors[i] = hex;
        Array.from(row.querySelectorAll('button')).forEach((b) => { b.style.borderColor = 'transparent'; });
        sw.style.borderColor = '#202124';
      });
      row.appendChild(sw);
    });
    wrap.appendChild(row);
  }

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button'; saveBtn.className = 'btn btn--primary'; saveBtn.textContent = 'Save set';
  saveBtn.style.marginTop = '4px';
  saveBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    const labels = rowInputs.map((x) => x.value.trim());
    if (!name) { setStatus('Set name required.', 'bad', 2500); return; }
    if (labels.some((l) => !l)) { setStatus('All 5 category names required.', 'bad', 2500); return; }
    saveBtn.disabled = true;
    google.script.run
      .withSuccessHandler((resp) => {
        saveBtn.disabled = false;
        if (!resp || !resp.ok) { setStatus('Could not create set.', 'bad', 3000); return; }
        bundles.push(resp.bundle);
        fields.bundleId = resp.bundle.bundleId;
        wrap.style.display = 'none';
        setStatus('Set "' + resp.bundle.name + '" created.', 'good', 2500);
        onCreated();
      })
      .withFailureHandler((e) => {
        saveBtn.disabled = false;
        setStatus((e && e.message) || 'Could not create set.', 'bad', 3500);
      })
      .consoleCreateBundle({ name, style: 'mla', labels, colors: rowColors });
  });
  wrap.appendChild(saveBtn);
  return wrap;
}
```

(If `makeField_`, `setStatus`, `updateCreateBtn_`, or the `btn--primary` class differ from the above, match the existing names already used in `console_js.html` — grep them; they are all used by the current modal.)

- [ ] **Step 4: Manual QA (push, then drive the console)**

`clasp push -f`, then open the console (`clasp open` → Web App `/exec`, or the deployed console URL). As a teacher:
1. Click **New project** → the Bundle dropdown lists real bundles + "➕ Create new set…".
2. Select "➕ Create new set…" → the sub-form appears; the dropdown snaps back to the previously-selected bundle.
3. Type a set name, name all 5 categories, pick a color per row → **Save set**.
4. Expect a green "Set … created" status; the dropdown now lists + selects the new set; the sub-form hides.
5. Finish creating the project on that set; reopen New project and confirm the set persists in the list.
6. Edge: leaving a category name blank → red "All 5 category names required."; leaving the set name blank → red "Set name required."

- [ ] **Step 5: Commit**

```powershell
cd C:\Users\paul.ivers\Desktop\ops-research-tool
git add apps-script/src/console_js.html
git commit -m "feat(console): create-new-set sub-form in the New Project wizard"
```

---

### Task A3: Redeploy + record

- [ ] **Step 1: Redeploy the Web App** (so the console + endpoint are live)

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\Users\paul.ivers\Desktop\ops-research-tool\apps-script
clasp deploy -i AKfycbwaWJe2cbmS3C0-HeKVI_Q0vALI8Jq-ivNZTcFZT_UuHHvBdBxSN0nwCwTpQrOI8FA -d "stage A: create-new-set wizard"
```

- [ ] **Step 2: Update CLAUDE.md** — in §4, replace the "Custom highlighter bundles are backend-only" note's claim that there is "no `consoleCreateBundle` endpoint or console UI" with the new reality (endpoint + wizard sub-form shipped; Custom option still pending Stage B). Commit.

## Self-review notes (Stage A)
- Spec coverage: §1 path 2 (create new set), §4.1 `consoleCreateBundle`, §7 wizard sub-form, §2 fixed-palette decision — all covered.
- No schema changes in Stage A.
- Type consistency: `consoleCreateBundle({name, style, labels, colors})` is called identically in the test and the client; returns `{ok, bundle}`.
