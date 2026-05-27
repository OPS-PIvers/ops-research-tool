# Sidebar Edit-Modal Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken global "Pop out" modal in the OPS Research Tool's Google Docs sidebar with a per-source editor modal, strip inline editing from the sidebar so it becomes a clean browse view, and add direct source deletion with an evidence-count confirmation.

**Architecture:** Two GAS HTML templates instead of one (`sidebar` + `source_editor`), separated JS files, shared CSS. The sidebar polls `sidebarGetProjectData` every 3 seconds while a modal is open to pick up edits (GAS modal iframes can't postMessage back). Modal autosaves on field change using existing endpoints; only two new server endpoints are added.

**Tech Stack:** Google Apps Script V8 runtime; Google Workspace Sheets storage; vanilla JS in the GAS HTML iframes (no bundler); `google.script.run` for client→server calls; `DocumentApp.getUi().showModalDialog` for the modal.

**Repo:** `C:\dev\ops-research-tool` (Windows, PowerShell default; bash also available)
**GAS deploy command** (refresh PATH first per `CLAUDE.md` §8): `cd C:\dev\ops-research-tool\apps-script; clasp push -f`
**Project ID:** `1IFhm0FJNiXSeDKGS8VnDfkhs8VY6ueWmHIvc6CIda1AcFXrh1skow2E3`
**Spec:** `docs/superpowers/specs/2026-05-27-sidebar-edit-modal-redesign.md`

---

## File Structure

After this plan completes:

```
apps-script/src/
  sidebar.html              ← MODIFIED (browse-only, no popout/mode flag)
  sidebar_js.html           ← MODIFIED (browse + dispatch + polling; no inline editors)
  sidebar_css.html          ← MODIFIED (shared tokens; dialog-mode rules removed)
  source_editor.html        ← NEW (modal template with bindings)
  source_editor_js.html     ← NEW (modal JS: citation form, evidence editor, delete)
  53_sidebar_api.js         ← MODIFIED (+sidebarOpenSourceEditor, +sidebarDeleteSource, –sidebarOpenAsDialog)
  99_dev.js                 ← MODIFIED (+devTestDeleteSource)
  50_docs_addon.js          ← UNCHANGED
  20_writes.js              ← UNCHANGED
  21_reads.js               ← UNCHANGED
  02_constants.js           ← UNCHANGED
```

No Chrome extension changes. No storage shape changes.

---

## Pre-flight (do once before starting)

- [ ] **P1: Confirm the working tree is clean and on a known starting commit**

```powershell
cd C:\dev\ops-research-tool
git status
git log -1 --oneline
```

Expected: working tree clean, on main (or wherever development branches off).

- [ ] **P2: Confirm clasp is logged in and pointed at the right project**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\dev\ops-research-tool\apps-script
clasp status
```

Expected: prints `Cloning files...` then a list including `src/sidebar.html`, `src/53_sidebar_api.js`, etc. The script id printed should be `1IFhm0FJNiXSeDKGS8VnDfkhs8VY6ueWmHIvc6CIda1AcFXrh1skow2E3`.

- [ ] **P3: Confirm the existing dev tests pass before any changes**

In your browser:
1. Open https://script.google.com/d/1IFhm0FJNiXSeDKGS8VnDfkhs8VY6ueWmHIvc6CIda1AcFXrh1skow2E3/edit
2. Open `99_dev.js`.
3. Select function `devTestNormalizeUrl` from the dropdown → Run. Expected log: `8/8 passed`.
4. Select `devTestRoundTrip` → Run. Expected: no thrown errors, logs show source + highlight write-back and idempotent re-send.

Do not proceed if either fails — you'd be conflating regressions.

---

## Task 1: Add `sidebarDeleteSource` server endpoint + dev test (TDD)

**Files:**
- Modify: `apps-script/src/99_dev.js` (add `devTestDeleteSource`)
- Modify: `apps-script/src/53_sidebar_api.js` (add `sidebarDeleteSource`)

This is the only task with a true test-first cycle — Apps Script tests are editor-callable functions you run from the GAS UI. Subsequent UI tasks have manual-verification steps.

- [ ] **Step 1: Write the failing test in `99_dev.js`**

Append to `apps-script/src/99_dev.js`:

```javascript
/**
 * Tests sidebarDeleteSource:
 *   - deletes all highlights pointing at the target source
 *   - deletes the source row itself
 *   - leaves other sources and their highlights untouched
 *   - idempotent on a missing source (returns deletedSource:false, no throw)
 */
function devTestDeleteSource() {
  const project = devSeedDevProject();
  const me = Session.getEffectiveUser().getEmail();
  const ss = findOrCreateStudentSheet_(me, project);

  // Seed: one target source with 3 highlights + one control source with 1 highlight.
  const targetSourceId = uuid_();
  const controlSourceId = uuid_();
  const targetHl = [uuid_(), uuid_(), uuid_()];
  const controlHl = uuid_();

  upsertSource_(ss, {
    sourceId: targetSourceId, projectId: project.projectId,
    rawUrl: 'https://target.example.com/page',
    scrapedTitle: 'Target', createdByEmail: me,
  });
  upsertSource_(ss, {
    sourceId: controlSourceId, projectId: project.projectId,
    rawUrl: 'https://control.example.com/page',
    scrapedTitle: 'Control', createdByEmail: me,
  });
  targetHl.forEach((hid) => upsertHighlight_(ss, {
    highlightId: hid, sourceId: targetSourceId, projectId: project.projectId,
    primaryCategory: 'Background', highlightedText: 'target text ' + hid,
    createdByEmail: me,
  }));
  upsertHighlight_(ss, {
    highlightId: controlHl, sourceId: controlSourceId, projectId: project.projectId,
    primaryCategory: 'Background', highlightedText: 'control text',
    createdByEmail: me,
  });

  // Act.
  const result = sidebarDeleteSource(project.projectId, targetSourceId);
  console.log('Delete result: ' + JSON.stringify(result));

  // Assert response shape.
  let pass = 0, fail = 0;
  const check = (label, cond) => {
    if (cond) { pass++; console.log('PASS ' + label); }
    else      { fail++; console.log('FAIL ' + label); }
  };
  check('result.ok',                   result && result.ok === true);
  check('deletedHighlights === 3',     result && result.deletedHighlights === 3);
  check('deletedSource === true',      result && result.deletedSource === true);

  // Assert sheet state.
  const sourcesAfter    = readSourcesForActor_(me, project.projectId);
  const highlightsAfter = readHighlightsForActor_(me, project.projectId);
  check('target source row gone',       !sourcesAfter.find((s) => s.sourceId === targetSourceId));
  check('control source row present',   !!sourcesAfter.find((s) => s.sourceId === controlSourceId));
  check('zero highlights for target',   highlightsAfter.filter((h) => h.sourceId === targetSourceId).length === 0);
  check('control highlight present',    !!highlightsAfter.find((h) => h.highlightId === controlHl));

  // Idempotency: deleting again should not throw.
  const result2 = sidebarDeleteSource(project.projectId, targetSourceId);
  console.log('Re-delete result: ' + JSON.stringify(result2));
  check('idempotent ok',                result2 && result2.ok === true);
  check('idempotent deletedHighlights', result2 && result2.deletedHighlights === 0);
  check('idempotent deletedSource',     result2 && result2.deletedSource === false);

  console.log(pass + '/' + (pass + fail) + ' passed');
}
```

- [ ] **Step 2: Push and run the test — verify it fails**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

Then in the GAS editor (reload it if it was open before the push):
1. Open `99_dev.js`.
2. Select `devTestDeleteSource` from the dropdown → Run.

Expected: ReferenceError or similar — `sidebarDeleteSource` is not defined. Confirm the error log mentions `sidebarDeleteSource`.

- [ ] **Step 3: Implement `sidebarDeleteSource` in `53_sidebar_api.js`**

Append to `apps-script/src/53_sidebar_api.js` (before the closing of the file, after the existing `sidebarInsertInlineCitation`):

```javascript
/**
 * Delete a source AND every highlight that references it, in one shot.
 * Idempotent: deleting a sourceId that no longer exists returns
 * { ok: true, deletedHighlights: 0, deletedSource: false } — never throws.
 *
 * Implementation strategy: read all rows for each tab, filter out the
 * matches, write the kept rows back. Doing one batched setValues per tab
 * (rather than row-by-row deleteRow calls) keeps us under the GAS script
 * timeout for sources with many highlights, and avoids the half-deleted
 * states deleteRow can leave on partial failures.
 */
function sidebarDeleteSource(projectId, sourceId) {
  const actorEmail = getActorEmail_();
  if (!projectId || !sourceId) throw new Error('projectId and sourceId required');
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown project ' + projectId);
  const studentSheet = findOrCreateStudentSheet_(actorEmail, project);

  const deletedHighlights = deleteAllRowsWhere_(
    getTab_(studentSheet, TABS.HIGHLIGHTS),
    HEADERS.HIGHLIGHTS,
    'sourceId',
    sourceId
  );
  const deletedSource = deleteAllRowsWhere_(
    getTab_(studentSheet, TABS.SOURCES),
    HEADERS.SOURCES,
    'sourceId',
    sourceId
  ) > 0;
  return { ok: true, deletedHighlights, deletedSource };
}

/**
 * Batched filter-then-rewrite delete. Returns the number of rows removed.
 * Preserves header row + any trailing blank rows that were already there.
 * Safe to call on a tab with zero data rows.
 */
function deleteAllRowsWhere_(tab, headers, keyCol, keyValue) {
  if (tab.getLastRow() < 2) return 0;
  const keyIdx = headers.indexOf(keyCol);
  if (keyIdx < 0) throw new Error('Unknown column ' + keyCol);
  const dataRows = tab.getRange(2, 1, tab.getLastRow() - 1, headers.length).getValues();
  const kept = dataRows.filter((row) => row[keyIdx] !== keyValue);
  const removed = dataRows.length - kept.length;
  if (removed === 0) return 0;

  // Clear the old data range, then write back the kept rows (if any).
  tab.getRange(2, 1, dataRows.length, headers.length).clearContent();
  if (kept.length > 0) {
    tab.getRange(2, 1, kept.length, headers.length).setValues(kept);
  }
  return removed;
}
```

- [ ] **Step 4: Push and run the test — verify it passes**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

In the GAS editor (reload), run `devTestDeleteSource`. Expected log ending: `9/9 passed`.

- [ ] **Step 5: Run the existing dev tests to confirm no regressions**

In the GAS editor:
1. Run `devTestNormalizeUrl` → expect `8/8 passed`.
2. Run `devTestRoundTrip` → expect no thrown errors, sources read-back length 1.

- [ ] **Step 6: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/99_dev.js apps-script/src/53_sidebar_api.js
git commit -m "feat(sidebar): add sidebarDeleteSource endpoint with batched delete"
```

---

## Task 2: Add `sidebarOpenSourceEditor` server endpoint

**Files:**
- Modify: `apps-script/src/53_sidebar_api.js` (add endpoint, remove `sidebarOpenAsDialog` — but only the endpoint; the sidebar HTML still references it and we'll remove that in Task 13)

Wait — leave `sidebarOpenAsDialog` in place for now. The sidebar's `⇱ Pop out` button still calls it, and we don't break working code while building. We remove the endpoint when we remove the button (Task 13).

- [ ] **Step 1: Append `sidebarOpenSourceEditor` to `53_sidebar_api.js`**

```javascript
/**
 * Open the per-source editor modal. The sidebar dispatches here when the
 * student clicks "Open in editor" on a source or evidence card.
 *
 * Template bindings: projectId, sourceId, focusHighlightId, and the active
 * bundle (serialized to JSON so the modal has color swatches without an
 * extra round trip).
 *
 * The modal opens at 820x720 — matches the dimensions chosen for the
 * deprecated sidebarOpenAsDialog and known-good in Docs at typical
 * laptop resolutions.
 */
function sidebarOpenSourceEditor(projectId, sourceId, focusHighlightId) {
  const actorEmail = getActorEmail_();
  if (!projectId || !sourceId) throw new Error('projectId and sourceId required');
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown project ' + projectId);

  // Verify the source belongs to this caller.
  const ss = getStudentSheetIfExists_(actorEmail, project);
  if (!ss) throw new Error('No data for this project yet');
  const sourcesTab = getTab_(ss, TABS.SOURCES);
  if (findRowByKey_(sourcesTab, HEADERS.SOURCES, 'sourceId', sourceId) < 0) {
    throw new Error('Source not found');
  }

  const bundle = listBundles_().find((b) => b.bundleId === project.bundleId) || null;

  const t = HtmlService.createTemplateFromFile('source_editor');
  t.projectId = projectId;
  t.sourceId = sourceId;
  t.focusHighlightId = focusHighlightId || '';
  t.bundleJson = JSON.stringify(bundle);
  const html = t.evaluate()
    .setWidth(820)
    .setHeight(720);
  DocumentApp.getUi().showModalDialog(html, 'Edit source');
  return { ok: true };
}
```

- [ ] **Step 2: Push to GAS**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

Expected: clean push. The endpoint exists but no template file exists yet, so calling it would fail — that's fine, we build the template in Task 3.

- [ ] **Step 3: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/53_sidebar_api.js
git commit -m "feat(sidebar): add sidebarOpenSourceEditor endpoint (template comes next)"
```

---

## Task 3: Modal HTML skeleton + bootstrap

**Files:**
- Create: `apps-script/src/source_editor.html`
- Create: `apps-script/src/source_editor_js.html`

At the end of this task, clicking the existing `⇱ Pop out` button (we'll temporarily rewire it for testing) should open the new modal showing the source's title in the header and "Citation" / "Evidence (N)" in the two empty panes.

- [ ] **Step 1: Create `apps-script/src/source_editor.html`**

```html
<!DOCTYPE html>
<html>
  <head>
    <base target="_top" />
    <?!= includeFile_('sidebar_css') ?>
    <script>
      window.OPS_EDITOR_CTX = {
        projectId:        <?= JSON.stringify(projectId) ?>,
        sourceId:         <?= JSON.stringify(sourceId) ?>,
        focusHighlightId: <?= JSON.stringify(focusHighlightId) ?>,
        bundle:           <?!= bundleJson ?>,
      };
    </script>
  </head>
  <body class="sb-body sb-body--modal">
    <header class="sb-modal__header">
      <button id="ed-close" type="button" class="sb-modal__close" title="Close">&times;</button>
      <h1 id="ed-title" class="sb-modal__title">Loading…</h1>
    </header>

    <div class="sb-modal__body">
      <section class="sb-modal__pane sb-modal__pane--left" id="ed-left">
        <h2 class="sb-modal__paneheader">Citation</h2>
        <div id="ed-citation" class="sb-modal__citation"></div>
      </section>

      <section class="sb-modal__pane sb-modal__pane--right" id="ed-right">
        <div class="sb-modal__paneheader-row">
          <h2 class="sb-modal__paneheader" id="ed-evheader">Evidence</h2>
        </div>
        <div id="ed-filter" class="sb-modal__filter"></div>
        <div id="ed-evidence" class="sb-modal__evidence"></div>
      </section>
    </div>

    <div id="ed-status" class="sb-modal__status"></div>

    <?!= includeFile_('source_editor_js') ?>
  </body>
</html>
```

- [ ] **Step 2: Create `apps-script/src/source_editor_js.html` with bootstrap-only logic**

```html
<script>
const SRC_TYPES = ['website', 'article', 'book', 'primary'];
const PS_OPTS = ['primary', 'secondary', 'unset'];

const ctx = window.OPS_EDITOR_CTX;
const editor = {
  source: null,
  highlights: [],
  bundle: ctx.bundle || null,
  perSourceFilter: null,
  editingHighlightId: null,
  confirmingHighlightDeleteId: null,
  confirmingSourceDelete: false,
};

const els = {
  title:    document.getElementById('ed-title'),
  close:    document.getElementById('ed-close'),
  citation: document.getElementById('ed-citation'),
  evHeader: document.getElementById('ed-evheader'),
  filter:   document.getElementById('ed-filter'),
  evidence: document.getElementById('ed-evidence'),
  status:   document.getElementById('ed-status'),
};

els.close.addEventListener('click', () => google.script.host.close());

bootstrap();

function bootstrap() {
  setStatus('Loading…');
  google.script.run
    .withSuccessHandler(onData)
    .withFailureHandler(onFail('loading source'))
    .sidebarGetProjectData(ctx.projectId);
}

function onData(resp) {
  if (!resp || !resp.ok) {
    renderEmpty('Could not load this source.');
    return;
  }
  editor.source = (resp.sources || []).find((s) => s.sourceId === ctx.sourceId) || null;
  editor.highlights = (resp.highlights || []).filter((h) => h.sourceId === ctx.sourceId);
  if (!editor.source) {
    renderEmpty('This source no longer exists. Close this window.');
    return;
  }
  setStatus('');
  render();
}

function render() {
  // Header title
  const title =
    (editor.source.citationFieldsParsed && editor.source.citationFieldsParsed.title) ||
    editor.source.scrapedTitle || '(untitled)';
  els.title.textContent = title;

  // Evidence count
  els.evHeader.textContent = 'Evidence (' + editor.highlights.length + ')';

  // Placeholders until Tasks 4-10 fill these.
  els.citation.innerHTML = '<div class="sb-modal__placeholder">Citation form coming in Task 4.</div>';
  els.evidence.innerHTML = '<div class="sb-modal__placeholder">Evidence list coming in Tasks 5+.</div>';
  els.filter.innerHTML = '';
}

function renderEmpty(message) {
  els.title.textContent = '';
  els.citation.innerHTML = '';
  els.filter.innerHTML = '';
  els.evidence.innerHTML = '<div class="sb-empty">' + esc_(message) + '</div>';
  setStatus('');
}

function setStatus(text, kind, autoClearMs) {
  els.status.textContent = text || '';
  els.status.className = 'sb-modal__status' + (kind ? ' sb-modal__status--' + kind : '');
  if (autoClearMs) {
    setTimeout(() => {
      if (els.status.textContent === text) {
        els.status.textContent = '';
        els.status.className = 'sb-modal__status';
      }
    }, autoClearMs);
  }
}

function onFail(stage) {
  return (e) => setStatus(stage + ': ' + (e && e.message || e), 'bad');
}

function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
</script>
```

- [ ] **Step 3: Add modal CSS to `sidebar_css.html`**

Append (before the closing `</style>`) to `apps-script/src/sidebar_css.html`:

```css
/* ---- Per-source editor modal ---- */
.sb-body--modal {
  height: 100vh;
  overflow-x: hidden;     /* critical — prevents horizontal scroll under any condition */
  overflow-y: hidden;
  display: flex;
  flex-direction: column;
}
.sb-modal__header {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--c-line);
  background: var(--c-bg);
  flex-shrink: 0;
}
.sb-modal__close {
  background: none; border: none; font-size: 22px; line-height: 1;
  color: var(--c-muted); padding: 0 8px; cursor: pointer;
}
.sb-modal__close:hover { color: var(--c-text); }
.sb-modal__title {
  margin: 0; font-size: 16px; font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  flex: 1; min-width: 0;
}
.sb-modal__body {
  flex: 1; min-height: 0;
  display: flex; gap: 12px;
  padding: 12px;
}
.sb-modal__pane {
  overflow-y: auto;
  min-width: 0;            /* critical — without this, flex children force horizontal overflow */
  display: flex; flex-direction: column; gap: 10px;
}
.sb-modal__pane--left  { flex: 0 0 46%; padding-right: 6px; border-right: 1px solid var(--c-line); }
.sb-modal__pane--right { flex: 1; }
.sb-modal__paneheader {
  margin: 0; font-size: 12px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.04em; color: var(--c-muted);
}
.sb-modal__paneheader-row {
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
}
.sb-modal__placeholder {
  padding: 12px; font-size: 12px; color: var(--c-muted); font-style: italic;
}
.sb-modal__status {
  padding: 4px 14px 8px; font-size: 11px; color: var(--c-muted); text-align: center;
  min-height: 14px; flex-shrink: 0;
}
.sb-modal__status--good { color: var(--c-good); }
.sb-modal__status--bad  { color: var(--c-bad); }
.sb-modal__filter {
  display: flex; flex-wrap: wrap; gap: 3px;
}
```

- [ ] **Step 4: Temporary test wiring — make the existing Pop out button open the new modal**

Edit `apps-script/src/sidebar_js.html`. Find the `popOutToDialog` function (around line 71) and replace its body:

Find:
```javascript
function popOutToDialog() {
  google.script.run
    .withFailureHandler(onFail('opening pop-out'))
    .sidebarOpenAsDialog();
}
```

Replace with:
```javascript
function popOutToDialog() {
  // TEMPORARY: rewired to open the new per-source editor against the first source
  // for smoke-testing. Reverted in Task 13.
  if (!state.sources || state.sources.length === 0) {
    setStatus('No sources to open.', 'warn');
    return;
  }
  google.script.run
    .withFailureHandler(onFail('opening editor'))
    .sidebarOpenSourceEditor(state.projectId, state.sources[0].sourceId, '');
}
```

- [ ] **Step 5: Push and verify visually**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

Then:
1. Open any Google Doc associated with the dev project.
2. Extensions → OPS Research Tool → Open research panel.
3. Wait for sources to load. If none, run `devTestRoundTrip` from the GAS editor first to seed one.
4. Click `⇱ Pop out`.

Expected:
- A modal opens, sized roughly 820×720.
- Header shows the first source's title.
- Left pane shows "Citation" header + "Citation form coming in Task 4." placeholder.
- Right pane shows "Evidence (N)" with the actual N + "Evidence list coming in Tasks 5+." placeholder.
- ✕ button in the top-left closes the modal.
- **No horizontal scrollbar** at the modal level even if you try to resize.

If any of those fail, fix before continuing.

- [ ] **Step 6: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/source_editor.html apps-script/src/source_editor_js.html apps-script/src/sidebar_css.html apps-script/src/sidebar_js.html
git commit -m "feat(sidebar): scaffold per-source editor modal (skeleton + bootstrap)"
```

---

## Task 4: Modal left pane — citation form

**Files:**
- Modify: `apps-script/src/source_editor_js.html` (replace placeholder citation render with real form)
- Modify: `apps-script/src/sidebar_css.html` (add citation form CSS — these are shared selectors with `.sb-source__form`; if they already cover us, no addition needed)

Goal: full citation editor — source type dropdown, per-type fields, primary/secondary radios, annotation textarea, MLA preview. Autosave on blur. Uses existing `sidebarUpdateSource` and `sidebarPreviewCitation` endpoints.

- [ ] **Step 1: Add citation rendering to `source_editor_js.html`**

In `source_editor_js.html`, replace the placeholder citation render inside `render()`:

Find:
```javascript
els.citation.innerHTML = '<div class="sb-modal__placeholder">Citation form coming in Task 4.</div>';
```

Replace with:
```javascript
els.citation.innerHTML = '';
els.citation.appendChild(renderCitationForm());
```

Then add these functions to the bottom of the `<script>` block, before `</script>`:

```javascript
function renderCitationForm() {
  const source = editor.source;
  const fields = Object.assign({}, source.citationFieldsParsed || {});
  fields.sourceType    = fields.sourceType    || source.sourceType || 'website';
  fields.title         = fields.title         || source.scrapedTitle || '';
  fields.siteName      = fields.siteName      || source.scrapedSite || '';
  fields.publishedDate = fields.publishedDate || source.scrapedDate || '';
  fields.author        = fields.author        || source.scrapedAuthor || '';
  fields.url           = fields.url           || source.rawUrl || '';
  fields.accessDate    = source.accessDate    || fields.accessDate || '';

  const form = document.createElement('div');
  form.className = 'sb-source__form';

  // Source type
  form.appendChild(formField_('Source type', selectInput_(SRC_TYPES, fields.sourceType, (v) => {
    fields.sourceType = v;
    saveSourcePatch_({ sourceType: v, citationFields: fields });
    source.sourceType = v;
    source.citationFieldsParsed = fields;
    render();   // re-render to swap the field set
  })));

  // Per-type fields
  sourceFieldsFor_(fields.sourceType).forEach((def) => {
    const onChange = (v) => {
      fields[def.key] = v;
      saveSourcePatch_({ citationFields: fields });
      source.citationFieldsParsed = fields;
      updatePreview_(form, fields);
    };
    form.appendChild(formField_(def.label, textInput_(fields[def.key] || '', onChange, def.kind)));
  });

  // Primary/secondary radios
  const psRow = document.createElement('div');
  psRow.className = 'sb-source__form-row';
  PS_OPTS.forEach((opt) => {
    const lab = document.createElement('label');
    const inp = document.createElement('input');
    inp.type = 'radio'; inp.name = 'ed-ps'; inp.value = opt;
    if ((source.primarySecondary || 'unset') === opt) inp.checked = true;
    inp.addEventListener('change', () => {
      saveSourcePatch_({ primarySecondary: opt });
      source.primarySecondary = opt;
    });
    lab.appendChild(inp);
    lab.appendChild(document.createTextNode(' ' + opt));
    psRow.appendChild(lab);
  });
  form.appendChild(formField_('Classification', psRow));

  // Annotation
  const annWrap = document.createElement('div');
  annWrap.className = 'sb-source__annotation';
  const annLabel = document.createElement('label'); annLabel.textContent = 'Annotation';
  const annTa = document.createElement('textarea');
  annTa.value = source.annotation || '';
  annTa.placeholder = '2–3 sentence annotation…';
  let annTimer;
  annTa.addEventListener('input', () => {
    clearTimeout(annTimer);
    annTimer = setTimeout(() => {
      saveSourcePatch_({ annotation: annTa.value });
      source.annotation = annTa.value;
    }, 600);
  });
  annWrap.appendChild(annLabel);
  annWrap.appendChild(annTa);
  form.appendChild(annWrap);

  // Live preview
  const preview = document.createElement('div');
  preview.className = 'sb-source__preview';
  preview.id = 'ed-preview';
  preview.innerHTML = '<em>Loading preview…</em>';
  form.appendChild(preview);
  updatePreview_(form, fields);

  return form;
}

function sourceFieldsFor_(sourceType) {
  switch (sourceType) {
    case 'website':
      return [
        { key: 'title', label: 'Title', kind: 'text' },
        { key: 'siteName', label: 'Site name', kind: 'text' },
        { key: 'author', label: 'Author', kind: 'text' },
        { key: 'publishedDate', label: 'Published date', kind: 'text' },
        { key: 'url', label: 'URL', kind: 'text' },
      ];
    case 'article':
      return [
        { key: 'title', label: 'Article title', kind: 'text' },
        { key: 'publication', label: 'Publication name', kind: 'text' },
        { key: 'author', label: 'Author', kind: 'text' },
        { key: 'publishedDate', label: 'Published date', kind: 'text' },
        { key: 'volume', label: 'Volume (opt.)', kind: 'text' },
        { key: 'issue', label: 'Issue (opt.)', kind: 'text' },
        { key: 'pages', label: 'Pages (opt.)', kind: 'text' },
        { key: 'url', label: 'URL', kind: 'text' },
      ];
    case 'book':
      return [
        { key: 'title', label: 'Book title', kind: 'text' },
        { key: 'author', label: 'Author', kind: 'text' },
        { key: 'publisher', label: 'Publisher', kind: 'text' },
        { key: 'publishedDate', label: 'Year', kind: 'text' },
      ];
    case 'primary':
      return [
        { key: 'title', label: 'Title', kind: 'text' },
        { key: 'author', label: 'Author / creator', kind: 'text' },
        { key: 'publishedDate', label: 'Date', kind: 'text' },
        { key: 'archive', label: 'Archive / repository', kind: 'text' },
        { key: 'url', label: 'URL', kind: 'text' },
      ];
    default:
      return [];
  }
}

function formField_(labelText, control) {
  const wrap = document.createElement('div');
  const lab = document.createElement('label');
  lab.textContent = labelText;
  wrap.appendChild(lab);
  wrap.appendChild(control);
  return wrap;
}

function textInput_(value, onCommit, kind) {
  const i = document.createElement('input');
  i.type = kind === 'date' ? 'date' : 'text';
  i.value = value || '';
  i.addEventListener('change', () => onCommit(i.value));
  i.addEventListener('blur', () => onCommit(i.value));
  return i;
}

function selectInput_(options, value, onChange) {
  const s = document.createElement('select');
  options.forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o; opt.textContent = o;
    if (o === value) opt.selected = true;
    s.appendChild(opt);
  });
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function updatePreview_(form, fields) {
  const previewEl = form.querySelector('#ed-preview') || form.querySelector('.sb-source__preview');
  if (!previewEl) return;
  google.script.run
    .withSuccessHandler((res) => {
      if (!res || !res.text) { previewEl.textContent = ''; return; }
      previewEl.innerHTML = renderPreviewHtml_(res);
    })
    .withFailureHandler(() => { /* ignore preview errors */ })
    .sidebarPreviewCitation(fields, 'mla');
}

function renderPreviewHtml_(formatted) {
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

function saveSourcePatch_(patch) {
  const merged = Object.assign({}, patch, { sourceId: ctx.sourceId, projectId: ctx.projectId });
  google.script.run
    .withSuccessHandler(() => setStatus('Saved.', 'good', 1500))
    .withFailureHandler(onFail('saving source'))
    .sidebarUpdateSource(merged);
}
```

- [ ] **Step 2: Push and visually verify**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

Reload the doc and open the modal via the temporary Pop out button.

Expected:
- Left pane now shows the full citation form: source type dropdown, per-type field set, primary/secondary radios, annotation textarea, MLA preview.
- Field set switches when you change source type.
- Changing a field, tabbing out, shows "Saved." in the status briefly.
- MLA preview text updates after a field change.
- No horizontal scroll inside the left pane — fields fit vertically.

- [ ] **Step 3: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/source_editor_js.html
git commit -m "feat(sidebar): modal citation form with autosave + MLA preview"
```

---

## Task 5: Modal right pane — evidence cards (read-only)

**Files:**
- Modify: `apps-script/src/source_editor_js.html` (replace evidence placeholder with read-only card render)
- Modify: `apps-script/src/sidebar_css.html` (add modal-specific evidence card CSS — most of `.sb-highlight` rules already apply)

- [ ] **Step 1: Replace evidence placeholder in `render()`**

Find:
```javascript
els.evidence.innerHTML = '<div class="sb-modal__placeholder">Evidence list coming in Tasks 5+.</div>';
els.filter.innerHTML = '';
```

Replace with:
```javascript
els.filter.innerHTML = '';   // filter chips come in Task 8
renderEvidenceList_();
```

Then add to the script:

```javascript
function renderEvidenceList_() {
  els.evidence.innerHTML = '';
  const visible = editor.highlights.filter(highlightPassesFilter_);
  if (visible.length === 0) {
    const e = document.createElement('div');
    e.className = 'sb-empty';
    e.textContent = editor.highlights.length === 0
      ? 'No evidence yet for this source.'
      : 'No evidence matches the current filter.';
    els.evidence.appendChild(e);
    return;
  }
  visible.forEach((h) => els.evidence.appendChild(renderEvidenceCard(h)));
}

function highlightPassesFilter_(h) {
  if (!editor.perSourceFilter) return true;
  return h.primaryCategory === editor.perSourceFilter || h.secondaryCategory === editor.perSourceFilter;
}

function renderEvidenceCard(h) {
  const card = document.createElement('div');
  card.className = 'sb-highlight';
  card.id = 'hl-' + h.highlightId;
  card.setAttribute('data-highlight-id', h.highlightId);

  const color = colorForLabel_(h.primaryCategory) || '#dadce0';
  const bar = document.createElement('div');
  bar.className = 'sb-highlight__bar';
  bar.style.backgroundColor = color;
  card.appendChild(bar);

  const cat = document.createElement('div');
  cat.className = 'sb-highlight__cat';
  cat.appendChild(document.createTextNode(h.primaryCategory || '(no category)'));
  if (h.secondaryCategory) {
    const sec = document.createElement('span');
    sec.className = 'sb-highlight__secondary';
    sec.textContent = '+ ' + h.secondaryCategory;
    cat.appendChild(sec);
  }
  card.appendChild(cat);

  // Full text — no truncation in the modal.
  const t = document.createElement('div');
  t.className = 'sb-highlight__text';
  t.textContent = h.highlightedText || '';
  card.appendChild(t);

  if (h.note) {
    const n = document.createElement('div');
    n.className = 'sb-highlight__note';
    n.textContent = h.note;
    card.appendChild(n);
  }

  // Actions come in Tasks 6+7.
  return card;
}

function colorForLabel_(label) {
  if (!editor.bundle || !label) return null;
  for (let i = 1; i <= 5; i++) {
    if (editor.bundle['label' + i] === label) return editor.bundle['color' + i];
  }
  return null;
}
```

- [ ] **Step 2: Push and visually verify**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

Reload doc, open modal.

Expected:
- Right pane lists every highlight on the source.
- Each card has the color bar, category label, full highlighted text (no `…` truncation), and the note in italics if present.
- Empty state shows if the source has no highlights.

- [ ] **Step 3: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/source_editor_js.html
git commit -m "feat(sidebar): modal evidence list (read-only)"
```

---

## Task 6: Modal evidence card — Edit (category swatches + note)

**Files:**
- Modify: `apps-script/src/source_editor_js.html` (add Edit action + mini-editor)

- [ ] **Step 1: Add Edit button to evidence cards**

In `renderEvidenceCard`, replace the trailing comment line:

Find:
```javascript
  // Actions come in Tasks 6+7.
  return card;
}
```

Replace with:
```javascript
  const actions = document.createElement('div');
  actions.className = 'sb-highlight__actions';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'sb-highlight__btn sb-highlight__btn--edit';
  editBtn.textContent = editor.editingHighlightId === h.highlightId ? 'Done' : 'Edit';
  editBtn.addEventListener('click', () => {
    editor.editingHighlightId = editor.editingHighlightId === h.highlightId ? null : h.highlightId;
    render();
  });
  actions.appendChild(editBtn);
  // Delete button comes in Task 7.
  card.appendChild(actions);

  if (editor.editingHighlightId === h.highlightId) {
    card.appendChild(renderHighlightMiniEditor_(h));
  }
  return card;
}

function renderHighlightMiniEditor_(h) {
  const editorEl = document.createElement('div');
  editorEl.style.marginTop = '8px';
  editorEl.style.paddingTop = '8px';
  editorEl.style.borderTop = '1px dashed var(--c-line)';

  if (!editor.bundle) {
    editorEl.textContent = '(bundle not loaded — cannot edit)';
    return editorEl;
  }

  // Primary category swatches.
  const primRow = document.createElement('div');
  primRow.style.cssText = 'display:flex; gap:4px; align-items:center; margin-bottom:6px; flex-wrap:wrap;';
  const primLabel = document.createElement('span');
  primLabel.style.cssText = 'font-size:10px; color:var(--c-muted); min-width:70px; text-transform:uppercase;';
  primLabel.textContent = 'Category';
  primRow.appendChild(primLabel);
  for (let i = 1; i <= 5; i++) {
    const label = editor.bundle['label' + i];
    const color = editor.bundle['color' + i];
    if (!label) continue;
    primRow.appendChild(swatch_(label, color, h.primaryCategory === label, () => {
      saveHighlightPatch_(h, { primaryCategory: label });
      h.primaryCategory = label;
      render();
    }));
  }
  editorEl.appendChild(primRow);

  // Secondary category swatches.
  const secRow = document.createElement('div');
  secRow.style.cssText = 'display:flex; gap:4px; align-items:center; margin-bottom:6px; flex-wrap:wrap;';
  const secLabel = document.createElement('span');
  secLabel.style.cssText = 'font-size:10px; color:var(--c-muted); min-width:70px; text-transform:uppercase;';
  secLabel.textContent = 'Secondary';
  secRow.appendChild(secLabel);
  for (let i = 1; i <= 5; i++) {
    const label = editor.bundle['label' + i];
    const color = editor.bundle['color' + i];
    if (!label) continue;
    secRow.appendChild(swatch_(label, color, h.secondaryCategory === label, () => {
      const next = h.secondaryCategory === label ? '' : label;
      saveHighlightPatch_(h, { secondaryCategory: next });
      h.secondaryCategory = next;
      render();
    }));
  }
  const noneBtn = document.createElement('button');
  noneBtn.type = 'button';
  noneBtn.style.cssText = 'width:22px; height:22px; border-radius:50%; border:2px dashed var(--c-muted); background:#fff; font-size:10px; color:var(--c-muted);';
  noneBtn.textContent = '∅';
  noneBtn.title = 'No secondary';
  noneBtn.addEventListener('click', () => {
    saveHighlightPatch_(h, { secondaryCategory: '' });
    h.secondaryCategory = '';
    render();
  });
  secRow.appendChild(noneBtn);
  editorEl.appendChild(secRow);

  // Note textarea.
  const noteWrap = document.createElement('div');
  const noteLabel = document.createElement('div');
  noteLabel.style.cssText = 'font-size:10px; color:var(--c-muted); text-transform:uppercase;';
  noteLabel.textContent = 'Note';
  const ta = document.createElement('textarea');
  ta.style.cssText = 'width:100%; border:1px solid var(--c-line); border-radius:4px; padding:4px 6px; font-size:12px; resize:vertical; min-height:40px;';
  ta.value = h.note || '';
  let timer;
  ta.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      saveHighlightPatch_(h, { note: ta.value });
      h.note = ta.value;
    }, 600);
  });
  noteWrap.appendChild(noteLabel);
  noteWrap.appendChild(ta);
  editorEl.appendChild(noteWrap);

  return editorEl;
}

function swatch_(label, color, active, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.title = label;
  b.style.cssText = 'width:22px; height:22px; border-radius:50%; border:2px solid ' + (active ? '#202124' : 'transparent') + '; padding:0; background:' + color + '; cursor:pointer; background-clip:padding-box;';
  b.addEventListener('click', onClick);
  return b;
}

function saveHighlightPatch_(highlight, patch) {
  const merged = Object.assign({}, patch, { highlightId: highlight.highlightId, projectId: ctx.projectId });
  google.script.run
    .withSuccessHandler(() => setStatus('Saved.', 'good', 1500))
    .withFailureHandler(onFail('saving highlight'))
    .sidebarUpdateHighlight(merged);
}
```

- [ ] **Step 2: Push and visually verify**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

Reload, open modal.

Expected:
- Each evidence card has an "Edit" button on the right.
- Clicking it expands the mini-editor with primary swatches, secondary swatches + ∅ (none), and a note textarea.
- Clicking a primary swatch updates color bar + category label and shows "Saved."
- Clicking a secondary swatch (and clicking again to deselect, or ∅) updates correctly.
- Typing in the note and tabbing away saves.
- Edit button reads "Done" while open; clicking it collapses the editor.

- [ ] **Step 3: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/source_editor_js.html
git commit -m "feat(sidebar): modal evidence Edit (swatches + note)"
```

---

## Task 7: Modal evidence card — Delete (two-step, last-evidence banner)

**Files:**
- Modify: `apps-script/src/source_editor_js.html`

- [ ] **Step 1: Add Delete button + optimistic delete to evidence cards**

In `renderEvidenceCard`, find:

```javascript
  actions.appendChild(editBtn);
  // Delete button comes in Task 7.
  card.appendChild(actions);
```

Replace with:

```javascript
  actions.appendChild(editBtn);
  if (editor.confirmingHighlightDeleteId === h.highlightId) {
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'sb-highlight__btn sb-highlight__btn--cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      editor.confirmingHighlightDeleteId = null;
      render();
    });
    actions.appendChild(cancelBtn);

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'sb-highlight__btn sb-highlight__btn--confirm';
    confirmBtn.textContent = 'Confirm delete';
    confirmBtn.addEventListener('click', () => optimisticallyDeleteHighlight_(h));
    actions.appendChild(confirmBtn);
  } else {
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'sb-highlight__btn sb-highlight__btn--delete';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      editor.confirmingHighlightDeleteId = h.highlightId;
      render();
    });
    actions.appendChild(delBtn);
  }
  card.appendChild(actions);
```

Then add the optimistic delete function:

```javascript
/**
 * Same snapshot/restore pattern the sidebar uses today, scoped to the modal's
 * local state. cascadeSource is ALWAYS false from the modal — the modal has
 * its own explicit "Delete source" button, so it never triggers an implicit
 * source-cascade when the last highlight goes away.
 */
function optimisticallyDeleteHighlight_(highlight) {
  const snapshotIdx = editor.highlights.findIndex((h) => h.highlightId === highlight.highlightId);
  const snapshot = highlight;

  editor.highlights = editor.highlights.filter((h) => h.highlightId !== highlight.highlightId);
  editor.confirmingHighlightDeleteId = null;
  if (editor.editingHighlightId === highlight.highlightId) editor.editingHighlightId = null;
  render();
  setStatus('Deleted.', 'good', 1500);

  google.script.run
    .withSuccessHandler(() => { /* already reflected */ })
    .withFailureHandler((e) => {
      const insertAt = (arr, idx, item) => {
        if (idx < 0 || idx > arr.length) arr.push(item);
        else arr.splice(idx, 0, item);
      };
      insertAt(editor.highlights, snapshotIdx, snapshot);
      render();
      setStatus('Delete failed: ' + (e && e.message || e), 'bad');
    })
    .sidebarDeleteHighlight(highlight.highlightId, ctx.projectId, false);
}
```

- [ ] **Step 2: Add the "last evidence" banner**

In `renderEvidenceList_`, after `els.evidence.innerHTML = '';` and before the visibility check, add:

```javascript
  if (editor.highlights.length === 0 && editor.source) {
    const banner = document.createElement('div');
    banner.className = 'sb-modal__banner';
    banner.textContent =
      'This source has no evidence. The source still exists — close the editor, or click "Delete source" below to remove it.';
    els.evidence.appendChild(banner);
  }
```

- [ ] **Step 3: Add banner CSS**

Append to `apps-script/src/sidebar_css.html` (inside the modal section):

```css
.sb-modal__banner {
  background: #fef7e0; border: 1px solid #f0d000; border-radius: 4px;
  padding: 8px 10px; font-size: 12px; color: #5f4400; margin-bottom: 8px;
}
```

- [ ] **Step 4: Push and visually verify**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

Reload, open modal on a source with at least 2 highlights.

Expected:
- Each card has Edit and Delete buttons.
- Clicking Delete swaps the row to Edit / Cancel / Confirm delete.
- Cancel returns to Edit / Delete state.
- Confirm delete removes the card immediately and shows "Deleted."
- Deleting until zero highlights remain shows the yellow banner.
- Banner does NOT appear when ≥1 highlight remains.

- [ ] **Step 5: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/source_editor_js.html apps-script/src/sidebar_css.html
git commit -m "feat(sidebar): modal evidence Delete with two-step confirm + last-evidence banner"
```

---

## Task 8: Modal — per-source category filter chips

**Files:**
- Modify: `apps-script/src/source_editor_js.html`

- [ ] **Step 1: Render filter chips**

In `render()`, replace:

```javascript
els.filter.innerHTML = '';   // filter chips come in Task 8
renderEvidenceList_();
```

With:

```javascript
renderFilterChips_();
renderEvidenceList_();
```

Then add the function:

```javascript
function renderFilterChips_() {
  els.filter.innerHTML = '';
  if (!editor.bundle) return;
  const breakdown = categoryBreakdown_();
  if (breakdown.length === 0) return;

  // "All" chip.
  const allCount = editor.highlights.length;
  els.filter.appendChild(makeFilterChip_(null, 'All', '#dadce0', allCount, editor.perSourceFilter === null));

  // Per-category chips.
  breakdown.forEach((b) => {
    els.filter.appendChild(
      makeFilterChip_(b.label, b.label, b.color, b.count, editor.perSourceFilter === b.label)
    );
  });
}

function categoryBreakdown_() {
  if (!editor.bundle) return [];
  const counts = {};
  editor.highlights.forEach((h) => {
    if (h.primaryCategory) counts[h.primaryCategory] = (counts[h.primaryCategory] || 0) + 1;
  });
  const out = [];
  for (let i = 1; i <= 5; i++) {
    const label = editor.bundle['label' + i];
    if (!label) continue;
    if (counts[label]) out.push({ label, color: editor.bundle['color' + i], count: counts[label] });
  }
  return out;
}

function makeFilterChip_(value, label, color, count, active) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'sb-filter-chip sb-filter-chip--mini' + (active ? ' sb-filter-chip--active' : '');
  const dot = document.createElement('span');
  dot.className = 'sb-filter-chip__dot';
  dot.style.backgroundColor = color;
  chip.appendChild(dot);
  chip.appendChild(document.createTextNode(label));
  const c = document.createElement('span');
  c.className = 'sb-filter-chip__count';
  c.textContent = count;
  chip.appendChild(c);
  chip.addEventListener('click', () => {
    editor.perSourceFilter = editor.perSourceFilter === value ? null : value;
    render();
  });
  return chip;
}
```

- [ ] **Step 2: Push and verify**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

Expected:
- Chip strip above the evidence list — All + one chip per primary category in use.
- Clicking a chip filters the evidence list.
- Clicking the same chip again deselects (back to All).

- [ ] **Step 3: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/source_editor_js.html
git commit -m "feat(sidebar): modal per-source category filter chips"
```

---

## Task 9: Modal — focus highlight on load

**Files:**
- Modify: `apps-script/src/source_editor_js.html`

When the modal is opened from a highlight card, `focusHighlightId` is set. After initial render, scroll that card into view and pre-expand its mini-editor.

- [ ] **Step 1: Add post-render focus logic**

In `onData(resp)`, after the `render();` call at the end, replace:

```javascript
  setStatus('');
  render();
}
```

With:

```javascript
  setStatus('');
  render();
  if (ctx.focusHighlightId) {
    // Pre-expand the editor for the target highlight, then re-render and scroll.
    if (editor.highlights.find((h) => h.highlightId === ctx.focusHighlightId)) {
      editor.editingHighlightId = ctx.focusHighlightId;
      render();
      const target = document.getElementById('hl-' + ctx.focusHighlightId);
      if (target) target.scrollIntoView({ behavior: 'auto', block: 'center' });
    }
  }
}
```

- [ ] **Step 2: Push and verify**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

Note: the existing temporary "Pop out" button doesn't pass a focusHighlightId, so for this task you need a quick test wiring change. Edit `sidebar_js.html`'s `popOutToDialog` again:

```javascript
function popOutToDialog() {
  if (!state.sources || state.sources.length === 0) {
    setStatus('No sources to open.', 'warn');
    return;
  }
  const firstSource = state.sources[0];
  const firstHl = state.highlights.find((h) => h.sourceId === firstSource.sourceId);
  google.script.run
    .withFailureHandler(onFail('opening editor'))
    .sidebarOpenSourceEditor(state.projectId, firstSource.sourceId, firstHl ? firstHl.highlightId : '');
}
```

Push and reload. Open modal on a source with multiple highlights.

Expected:
- Modal opens with the first highlight on that source auto-expanded (mini-editor visible).
- That card is scrolled into view inside the right pane (centered).
- If no focusHighlightId or the highlight isn't found, modal opens normally with no editor expanded — verify by tweaking the test wiring temporarily.

- [ ] **Step 3: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/source_editor_js.html apps-script/src/sidebar_js.html
git commit -m "feat(sidebar): modal focus-scroll + auto-expand for target highlight"
```

---

## Task 10: Modal — Delete source button

**Files:**
- Modify: `apps-script/src/source_editor_js.html` (add delete button + flow)
- Modify: `apps-script/src/sidebar_css.html` (add danger button styles)

- [ ] **Step 1: Add delete button to the citation form**

In `renderCitationForm()`, at the very end of the function — after `form.appendChild(preview);` and before `return form;` — add:

```javascript
  // Delete source — at the bottom of the left pane, after preview.
  const dangerWrap = document.createElement('div');
  dangerWrap.className = 'sb-modal__danger';
  dangerWrap.appendChild(renderDeleteSourceUi_());
  form.appendChild(dangerWrap);
```

Then add the rendering function:

```javascript
function renderDeleteSourceUi_() {
  const wrap = document.createElement('div');
  if (editor.confirmingSourceDelete) {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'sb-modal__btn sb-modal__btn--cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      editor.confirmingSourceDelete = false;
      render();
    });
    wrap.appendChild(cancel);

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'sb-modal__btn sb-modal__btn--danger';
    const n = editor.highlights.length;
    confirm.textContent = n > 0
      ? 'Confirm — delete source and ' + n + ' piece' + (n === 1 ? '' : 's') + ' of evidence'
      : 'Confirm — delete source';
    confirm.addEventListener('click', performDeleteSource_);
    wrap.appendChild(confirm);
  } else {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sb-modal__btn sb-modal__btn--danger-outline';
    btn.textContent = '🗑  Delete source';
    btn.addEventListener('click', () => {
      editor.confirmingSourceDelete = true;
      render();
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

/**
 * Non-optimistic delete — modal stays open until the server confirms. On
 * success, close the modal; the sidebar's polling loop picks up the
 * deletion on its next tick. On failure, revert to the initial single-button
 * state and surface the error.
 */
function performDeleteSource_() {
  setStatus('Deleting…');
  google.script.run
    .withSuccessHandler(() => {
      google.script.host.close();
    })
    .withFailureHandler((e) => {
      editor.confirmingSourceDelete = false;
      render();
      setStatus('Delete failed: ' + (e && e.message || e), 'bad');
    })
    .sidebarDeleteSource(ctx.projectId, ctx.sourceId);
}
```

- [ ] **Step 2: Add danger button CSS**

Append to the modal section in `apps-script/src/sidebar_css.html`:

```css
.sb-modal__danger {
  margin-top: 16px; padding-top: 12px;
  border-top: 1px solid var(--c-line);
  display: flex; gap: 6px; flex-wrap: wrap;
}
.sb-modal__btn {
  padding: 6px 10px; border-radius: 4px; font-size: 12px;
  border: 1px solid var(--c-line); background: #fff; cursor: pointer;
}
.sb-modal__btn--cancel { color: var(--c-muted); }
.sb-modal__btn--danger-outline {
  color: var(--c-bad); border-color: var(--c-bad); background: #fff;
}
.sb-modal__btn--danger-outline:hover { background: #fce8e6; }
.sb-modal__btn--danger {
  background: var(--c-bad); color: #fff; border-color: var(--c-bad);
  font-weight: 500;
}
.sb-modal__btn--danger:hover { filter: brightness(1.05); }
```

- [ ] **Step 3: Push and verify**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

Reload. Open modal.

Expected:
- Left pane has "🗑 Delete source" button below the MLA preview.
- First click swaps to "Cancel" + "Confirm — delete source and N piece(s) of evidence" (or just "...delete source" if N = 0).
- Cancel reverts.
- Confirm deletes server-side, modal closes.
- Returning to the sidebar — the source still shows until the polling loop is implemented in Task 12. For now, manually click the sidebar's project picker or a view-mode pill to force a reload, and confirm the source is gone.
- Failure case: edit `sidebarDeleteSource` in the GAS editor to `throw new Error('test')` at the top, push, repeat. Modal should stay open with red error and the button reverts to single-button state. Undo the change.

- [ ] **Step 4: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/source_editor_js.html apps-script/src/sidebar_css.html
git commit -m "feat(sidebar): modal Delete source with two-step confirm + evidence count"
```

---

## Task 11: Sidebar — add "Open in editor" buttons

**Files:**
- Modify: `apps-script/src/sidebar_js.html` (add buttons to source cards + highlight rows, dispatch to `sidebarOpenSourceEditor`)

After this task, the sidebar has BOTH the old inline editing AND the new "Open in editor" entry points. The cleanup happens in Task 13 — keeping them parallel for now lets us verify the modal flow in isolation.

- [ ] **Step 1: Add "Open in editor" to source cards**

In `sidebar_js.html`, find the `renderSource` function — specifically the meta row where the action buttons are added. Find:

```javascript
  const expand = document.createElement('button');
  expand.type = 'button';
  expand.className = 'sb-source__action sb-source__expand';
  expand.textContent = state.expandedSourceId === source.sourceId ? 'Hide citation' : 'Edit citation';
  expand.addEventListener('click', (e) => {
```

Immediately BEFORE that `expand` button block, add an "Open in editor" button:

```javascript
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'sb-source__action';
  openBtn.textContent = 'Open in editor';
  openBtn.title = 'Open this source in the editor';
  openBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openSourceEditor_(source.sourceId, null);
  });
  meta.appendChild(openBtn);
```

- [ ] **Step 2: Add "Open in editor" to highlight rows**

In the same file, find the `renderHighlight` function — specifically the actions block where Edit/Delete buttons are added. Right after the existing `editBtn` is appended to `actions`:

Find:
```javascript
  actions.appendChild(editBtn);
```

Immediately after, add:

```javascript
  const openInEditor = document.createElement('button');
  openInEditor.type = 'button';
  openInEditor.className = 'sb-highlight__btn sb-highlight__btn--edit';
  openInEditor.textContent = 'Open in editor';
  openInEditor.addEventListener('click', () => openSourceEditor_(source.sourceId, h.highlightId));
  actions.appendChild(openInEditor);
```

- [ ] **Step 3: Add the dispatch helper**

Anywhere in the `<script>` block (e.g., right before `function saveSourcePatch_`), add:

```javascript
/**
 * Open the per-source editor modal. Stores the sourceId in state so the
 * sidebar's polling loop (Task 12) knows to refresh while the modal is open.
 */
function openSourceEditor_(sourceId, focusHighlightId) {
  state.modalOpenForSourceId = sourceId;
  state.lastDataJson = JSON.stringify({ sources: state.sources, highlights: state.highlights });
  startEditorPolling_();   // defined in Task 12
  google.script.run
    .withFailureHandler((e) => {
      state.modalOpenForSourceId = null;
      stopEditorPolling_();   // defined in Task 12
      onFail('opening editor')(e);
    })
    .sidebarOpenSourceEditor(state.projectId, sourceId, focusHighlightId || '');
}

// Placeholders so calls work before Task 12 lands.
function startEditorPolling_() { /* implemented in Task 12 */ }
function stopEditorPolling_()  { /* implemented in Task 12 */ }
```

Also add the new state fields to the `state` object literal at the top of the file. Find:

```javascript
const state = {
  ctx: null,           // sidebarGetContext response
  projectId: null,
  sources: [],
  highlights: [],
```

And in that same block, append before the closing `};`:

```javascript
  modalOpenForSourceId: null,   // sourceId of the currently-open modal (drives polling)
  lastDataJson: null,           // JSON of last sidebarGetProjectData response (polling diff)
  pollHandle: null,             // setInterval handle for the modal-open polling loop
  pollUnchangedTicks: 0,        // bounded fallback stop counter
```

- [ ] **Step 4: Push and verify**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

Reload. Expected:
- Each source card now has BOTH "Open in editor" AND "Edit citation" buttons (and "Insert in-text").
- Each highlight row now has "Edit" AND "Open in editor" AND "Delete".
- Clicking "Open in editor" on a source opens the modal (no focusHighlightId).
- Clicking "Open in editor" on a highlight opens the modal and that highlight is auto-expanded + scrolled.

- [ ] **Step 5: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/sidebar_js.html
git commit -m "feat(sidebar): add 'Open in editor' buttons on source + highlight cards"
```

---

## Task 12: Sidebar — 3-second polling loop

**Files:**
- Modify: `apps-script/src/sidebar_js.html` (replace placeholder polling helpers with real impl)

- [ ] **Step 1: Replace the placeholder polling helpers**

Find the placeholders added in Task 11:

```javascript
// Placeholders so calls work before Task 12 lands.
function startEditorPolling_() { /* implemented in Task 12 */ }
function stopEditorPolling_()  { /* implemented in Task 12 */ }
```

Replace with:

```javascript
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_UNCHANGED_TICKS = 200;   // ~10 minutes — bounded fallback stop

/**
 * While a modal is open, refetch project data every 3s and diff against
 * the previous response. On change, update local state and re-render.
 *
 * Stop conditions:
 *   (a) the sourceId the modal opened on disappears from the response
 *       (the modal deleted the source);
 *   (b) we hit POLL_MAX_UNCHANGED_TICKS unchanged ticks in a row (the
 *       user closed the modal without edits and we shouldn't poll
 *       forever).
 */
function startEditorPolling_() {
  if (state.pollHandle) return;
  state.pollUnchangedTicks = 0;
  state.pollHandle = setInterval(pollTick_, POLL_INTERVAL_MS);
}

function stopEditorPolling_() {
  if (!state.pollHandle) return;
  clearInterval(state.pollHandle);
  state.pollHandle = null;
  state.modalOpenForSourceId = null;
  state.pollUnchangedTicks = 0;
}

function pollTick_() {
  if (!state.modalOpenForSourceId || !state.projectId) {
    stopEditorPolling_();
    return;
  }
  google.script.run
    .withSuccessHandler(onPollResponse_)
    .withFailureHandler(() => { /* swallow transient errors; retry next tick */ })
    .sidebarGetProjectData(state.projectId);
}

function onPollResponse_(resp) {
  if (!resp || !resp.ok) return;
  const json = JSON.stringify({ sources: resp.sources, highlights: resp.highlights });
  if (json === state.lastDataJson) {
    state.pollUnchangedTicks++;
    if (state.pollUnchangedTicks >= POLL_MAX_UNCHANGED_TICKS) stopEditorPolling_();
    return;
  }
  state.pollUnchangedTicks = 0;
  state.lastDataJson = json;
  state.sources = resp.sources || [];
  state.highlights = resp.highlights || [];
  state.confirmingDeleteId = null;
  els.insert.disabled = state.sources.length === 0;
  renderFilter();
  render();

  // Heuristic: if the source the modal opened on is gone, the modal closed
  // via a source delete. Stop polling.
  const stillExists = state.sources.some((s) => s.sourceId === state.modalOpenForSourceId);
  if (!stillExists) stopEditorPolling_();
}
```

- [ ] **Step 2: Push and verify**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

Reload. Verify the following:

**Sync test:**
1. Click "Open in editor" on a source.
2. In the modal, change the source title.
3. Wait ~3s. The sidebar (visible behind the modal) should update the title.
4. Close the modal. The sidebar still has the new title.

**Delete-source stop:**
1. Open modal on a source.
2. Delete the source via the modal's Delete source flow.
3. Modal closes. Within ~3s the sidebar's list updates and the source is gone.
4. Open browser dev tools on the sidebar iframe (right-click → Inspect) and verify the network tab shows no further polls after the source disappeared.

**Bounded stop:**
1. Open a modal. Make no edits.
2. Wait ~10 minutes (or temporarily edit `POLL_MAX_UNCHANGED_TICKS` to `3` to make the test fast, push, repeat, then change it back).
3. After the cap, polling stops. Verify in the network tab.

- [ ] **Step 3: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/sidebar_js.html
git commit -m "feat(sidebar): 3s polling loop syncs sidebar with open modal"
```

---

## Task 13: Sidebar cleanup — strip inline editing + popout

**Files:**
- Modify: `apps-script/src/sidebar.html` (remove Pop out button, `mode` template var, `OPS_MODE` script)
- Modify: `apps-script/src/sidebar_js.html` (remove inline citation form, inline highlight editor, popout handler; shrink state)
- Modify: `apps-script/src/sidebar_css.html` (remove `.sb-body--dialog` rules + `.sb-popout`)
- Modify: `apps-script/src/53_sidebar_api.js` (remove `sidebarOpenAsDialog`)

- [ ] **Step 1: Strip the popout button from `sidebar.html`**

Open `apps-script/src/sidebar.html`. Replace the `<head>` and `<body>` opening:

Find:
```html
    <?!= includeFile_('sidebar_css') ?>
    <script>window.OPS_MODE = '<?= mode || "sidebar" ?>';</script>
  </head>
  <body class="sb-body sb-body--<?= mode || "sidebar" ?>">
    <header class="sb-header">
      <div class="sb-header__row">
        <h1 class="sb-title">OPS Research Tool</h1>
        <? if ((mode || 'sidebar') === 'sidebar') { ?>
          <button id="sb-popout" type="button" class="sb-popout" title="Pop out to a wider window">⇱ Pop out</button>
        <? } ?>
      </div>
      <div id="sb-actor" class="sb-actor"></div>
    </header>
```

Replace with:
```html
    <?!= includeFile_('sidebar_css') ?>
  </head>
  <body class="sb-body">
    <header class="sb-header">
      <div class="sb-header__row">
        <h1 class="sb-title">OPS Research Tool</h1>
      </div>
      <div id="sb-actor" class="sb-actor"></div>
    </header>
```

- [ ] **Step 2: Strip popout + inline editor handlers from `sidebar_js.html`**

In `apps-script/src/sidebar_js.html`:

a) In the `els` object, remove the `popout` line:

Find:
```javascript
  popout: document.getElementById('sb-popout'),
```

Delete that line entirely.

b) In `bootstrap()`, remove the popout listener:

Find:
```javascript
  if (els.popout) els.popout.addEventListener('click', popOutToDialog);
```

Delete that line.

c) Delete the entire `popOutToDialog` function.

d) Remove inline state fields. In `state`, find:
```javascript
  expandedSourceId: null,   // sourceId whose citation form is open (singular)
  editingHighlightId: null,
  confirmingDeleteId: null, // highlightId whose Delete button is in its second-click "Confirm" state
```

Delete those three lines.

e) In `renderSource`, remove the "Edit citation" button block and the form render. Find:

```javascript
  const expand = document.createElement('button');
  expand.type = 'button';
  expand.className = 'sb-source__action sb-source__expand';
  expand.textContent = state.expandedSourceId === source.sourceId ? 'Hide citation' : 'Edit citation';
  expand.addEventListener('click', (e) => {
    e.stopPropagation();
    state.expandedSourceId = state.expandedSourceId === source.sourceId ? null : source.sourceId;
    // Auto-expand the source in source mode when opening the citation form.
    if (state.expandedSourceId === source.sourceId && sourceMode) {
      state.expandedSourceIds[source.sourceId] = true;
    }
    render();
  });
  meta.appendChild(expand);
  card.appendChild(meta);

  if (state.expandedSourceId === source.sourceId) {
    card.appendChild(renderSourceForm(source));
  }
```

Replace with:

```javascript
  card.appendChild(meta);
```

f) In `renderHighlight`, remove the inline Edit/Done toggle behavior and the inline Delete two-step. Find:

```javascript
  const actions = document.createElement('div');
  actions.className = 'sb-highlight__actions';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'sb-highlight__btn sb-highlight__btn--edit';
  editBtn.textContent = state.editingHighlightId === h.highlightId ? 'Done' : 'Edit';
  editBtn.addEventListener('click', () => {
    state.editingHighlightId = state.editingHighlightId === h.highlightId ? null : h.highlightId;
    render();
  });
  actions.appendChild(editBtn);

  const openInEditor = document.createElement('button');
  openInEditor.type = 'button';
  openInEditor.className = 'sb-highlight__btn sb-highlight__btn--edit';
  openInEditor.textContent = 'Open in editor';
  openInEditor.addEventListener('click', () => openSourceEditor_(source.sourceId, h.highlightId));
  actions.appendChild(openInEditor);

  // Two-step inline delete. First click on Delete turns the action row
  // into [Cancel][Confirm delete]; second click optimistically removes
  // the row locally and fires the server delete in the background.
  if (state.confirmingDeleteId === h.highlightId) {
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'sb-highlight__btn sb-highlight__btn--cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      state.confirmingDeleteId = null;
      render();
    });
    actions.appendChild(cancelBtn);

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'sb-highlight__btn sb-highlight__btn--confirm';
    confirmBtn.textContent = 'Confirm delete';
    confirmBtn.addEventListener('click', () => optimisticallyDeleteHighlight_(source, h));
    actions.appendChild(confirmBtn);
  } else {
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'sb-highlight__btn sb-highlight__btn--delete';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      state.confirmingDeleteId = h.highlightId;
      render();
    });
    actions.appendChild(delBtn);
  }
  row.appendChild(actions);

  if (state.editingHighlightId === h.highlightId) {
    row.appendChild(renderHighlightEditor(h));
  }
```

Replace with:

```javascript
  const actions = document.createElement('div');
  actions.className = 'sb-highlight__actions';
  const openInEditor = document.createElement('button');
  openInEditor.type = 'button';
  openInEditor.className = 'sb-highlight__btn sb-highlight__btn--edit';
  openInEditor.textContent = 'Open in editor';
  openInEditor.addEventListener('click', () => openSourceEditor_(source.sourceId, h.highlightId));
  actions.appendChild(openInEditor);
  row.appendChild(actions);
```

g) Delete the entire `renderSourceForm` function and everything it depends on that's no longer used by the sidebar. To stay safe, delete:

- `function renderSourceForm(source) { ... }` — entire function.
- `function sourceFieldsFor_(sourceType) { ... }` — entire function (moved to modal).
- `function formField_(...)` — entire function.
- `function textInput_(...)` — entire function.
- `function selectInput_(...)` — entire function.
- `function formatPreview_(...)` — entire function.
- `function updatePreview_(...)` — entire function.
- `function renderPreviewHtml_(...)` — entire function.
- `function renderHighlightEditor(h) { ... }` — entire function.
- `function swatch_(...)` — entire function.
- `function saveHighlightPatch_(...)` — entire function.
- `function optimisticallyDeleteHighlight_(...)` — entire function.

Keep: `colorForLabel_`, `truncate_`, `esc_`, `saveSourcePatch_`, `setStatus`, `onFail`. (Several of these are still used by the sidebar render — verify with a quick grep before deleting.)

- [ ] **Step 3: Strip dialog-mode and popout CSS from `sidebar_css.html`**

In `apps-script/src/sidebar_css.html`, delete:

a) The `.sb-popout` selector block:
```css
.sb-popout {
  background: none; border: 1px solid var(--c-line); border-radius: 4px;
  padding: 2px 6px; font-size: 11px; color: var(--c-muted);
}
.sb-popout:hover { color: var(--c-accent); border-color: var(--c-accent); }
```

b) The dialog-mode block at the bottom:
```css
/* ---- Dialog (pop-out) mode: wider, multi-column source cards ---- */
.sb-body--dialog .sb-main {
  height: calc(100vh - 240px);
}
.sb-body--dialog .sb-main {
  column-count: 2;
  column-gap: 12px;
  padding: 8px 12px 0;
}
.sb-body--dialog .sb-source {
  break-inside: avoid;
  margin: 0 0 12px;
}
.sb-body--dialog .sb-title { font-size: 16px; }
.sb-body--dialog .sb-empty { column-span: all; }
```

c) Selectors that only existed for the inline edit forms — keep `.sb-source__form` etc. ONLY if grep shows the modal still uses them. The modal applies its own class names but also uses some shared ones. Don't aggressively prune; the cost of a few unused selectors is low vs. the risk of breaking the modal's appearance. Verify:

```powershell
cd C:\dev\ops-research-tool\apps-script\src
```

Then in your tool of choice grep for usages of `.sb-source__form`, `.sb-source__preview`, `.sb-source__annotation`, `.sb-source__form-row`. If they still appear in `source_editor_js.html`, keep the CSS. Most likely you keep all of them.

- [ ] **Step 4: Remove `sidebarOpenAsDialog` from the server**

In `apps-script/src/53_sidebar_api.js`, find the `sidebarOpenAsDialog` function. Currently it's not there — it lives in `50_docs_addon.js`. Open `apps-script/src/50_docs_addon.js`. Find:

```javascript
/**
 * Reopen the sidebar UI as a wider modal dialog for citation editing.
 * The doc behind is uneditable while the dialog is open — explicit trade-off
 * for more horizontal room. Closing the dialog returns to the sidebar.
 *
 * Width is capped by Docs (~1000px on a typical screen). Height adapts.
 */
function sidebarOpenAsDialog() {
  const t = HtmlService.createTemplateFromFile('sidebar');
  t.mode = 'dialog';
  const html = t.evaluate()
    .setWidth(820)
    .setHeight(720);
  DocumentApp.getUi().showModalDialog(html, 'OPS Research Tool');
  return { ok: true };
}
```

Delete the entire function (including its leading docstring).

Also in `showSidebar`, remove the `t.mode = 'sidebar'` line since the template no longer reads `mode`:

Find:
```javascript
function showSidebar() {
  const t = HtmlService.createTemplateFromFile('sidebar');
  t.mode = 'sidebar';
  const html = t.evaluate()
    .setTitle('OPS Research Tool')
    .setWidth(360);
  DocumentApp.getUi().showSidebar(html);
}
```

Replace with:
```javascript
function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('sidebar')
    .setTitle('OPS Research Tool')
    .setWidth(360);
  DocumentApp.getUi().showSidebar(html);
}
```

(The `t.mode = 'sidebar'` was the only template binding; `createHtmlOutputFromFile` is the simpler path now that the template tags are gone from `sidebar.html`.)

Wait — Step 1 above did NOT remove the `<? if ((mode || 'sidebar') === 'sidebar') { ?>` scriptlet from `sidebar.html`. Re-check that file — the replacement we did should have removed the conditional block entirely. Verify by reading the head/body now:

```powershell
```

(Open `apps-script/src/sidebar.html` in your editor and confirm: no more `<? ... ?>` scriptlets in the file. The file should now be pure HTML.)

If any scriptlets remain, `createHtmlOutputFromFile` will return the raw text and break. In that case revert to `HtmlService.createTemplateFromFile('sidebar').evaluate()` without any template bindings.

- [ ] **Step 5: Push and verify**

```powershell
cd C:\dev\ops-research-tool\apps-script
clasp push -f
```

Reload the doc and open the sidebar.

Expected:
- No `⇱ Pop out` button in the header.
- Source cards: title, URL, primary/secondary chip, breakdown dots (source mode), highlight count + "Insert in-text" + "Open in editor" buttons.
- Highlight rows: color bar, category labels, text (truncated to 240 chars), note, and a SINGLE "Open in editor" button. No "Edit" or "Delete" buttons in the sidebar anymore.
- Clicking "Open in editor" on a source still opens the modal.
- Clicking "Open in editor" on a highlight still opens the modal scrolled+expanded.
- All editing (citation, category, note, delete) is in the modal.
- No JavaScript errors in the browser console (right-click sidebar → Inspect).

- [ ] **Step 6: Commit**

```powershell
cd C:\dev\ops-research-tool
git add apps-script/src/sidebar.html apps-script/src/sidebar_js.html apps-script/src/sidebar_css.html apps-script/src/50_docs_addon.js
git commit -m "refactor(sidebar): remove inline editing + popout, leaving browse-only view"
```

---

## Task 14: Manual QA pass + push

**Files:**
- None modified (verification only).

Run the full manual QA matrix from the spec. Each item below either passes (check it off) or you fix the issue (back to whichever earlier task it touches, repeat) and re-run.

- [ ] **Step 1: QA — open paths**

- Open modal from a source card → modal opens with that source.
- Open modal from a highlight card → modal opens, that highlight is scrolled into view and its mini-editor is pre-expanded.

- [ ] **Step 2: QA — citation editing**

- Type into a citation field, blur. "Saved." appears. Close modal, reopen → value persisted.
- Change source type. Field set swaps. Old fields not destroyed (re-select original source type and verify values still there).
- Change Classification radio. Status shows Saved. Close + reopen → persisted.
- Type into Annotation. Wait > 600 ms. Saved.

- [ ] **Step 3: QA — evidence editing**

- Click Edit on an evidence card. Mini-editor expands.
- Click a primary swatch. Color bar updates immediately. Saved.
- Click the same primary swatch (deselect) — verify behavior matches your expectation.
- Click a secondary swatch. Then click ∅. Secondary clears.
- Type in note textarea. Wait. Saved.
- Click Done. Editor collapses.
- Reopen the modal — all changes persisted.

- [ ] **Step 4: QA — evidence delete**

- Delete an evidence card in the middle of the list. Row vanishes, others shift up. Reopen → persisted.
- Delete the last evidence on a source. Yellow banner appears. Source still exists.
- Force a failure: in GAS editor, temporarily make `sidebarDeleteHighlight` throw. Push. Try to delete. Card reverts; red error in status. Undo.

- [ ] **Step 5: QA — source delete**

- Click 🗑 Delete source on a source with 0 highlights. Confirm reads "delete source" (no count). Click confirm. Modal closes. Within 3s sidebar list refreshes; source gone.
- Click 🗑 Delete source on a source with N highlights. Confirm reads "delete source and N piece(s) of evidence". Confirm. Modal closes; sidebar refreshes; source + all highlights gone.
- Open modal on a source. Delete source. Run `devDumpMyData` in GAS editor and verify the source AND all its highlights are gone from the sheet — not just the source row.

- [ ] **Step 6: QA — layout**

- Resize the Docs window narrower. Modal never shows a horizontal scrollbar.
- Open modal on a source with a 5000-character highlight. Right pane scrolls vertically. No horizontal scroll.
- Open modal on a source with many highlights (10+). Right pane scrolls vertically; left pane stays fixed (independent scroll).
- Click the ✕ in the modal header. Modal closes. Sidebar still works.

- [ ] **Step 7: QA — sidebar polling**

- Open modal. Don't edit. After ~9 seconds, no errors in the network tab — just `sidebarGetProjectData` calls every 3s.
- Open modal. Edit a category. Sidebar reflects within 3s (visible behind the modal).
- Close modal. Polling continues briefly (until source-still-exists check passes with 0 changes for the unchanged-tick cap, OR you open another modal which resets the loop).

- [ ] **Step 8: QA — Insert Bibliography unchanged**

- Click "Insert Annotated Bibliography" in the sidebar footer. Verify MLA output renders correctly for at least one source of each type that exists in the project.

- [ ] **Step 9: QA — server tests**

In GAS editor, run all of:
- `devTestNormalizeUrl` → 8/8 passed
- `devTestRoundTrip` → no errors
- `devTestSourceDedup` → PASS
- `devTestDeleteSource` → 9/9 passed

All green before continuing.

- [ ] **Step 10: Final commit (if any QA fixes landed) + push**

```powershell
cd C:\dev\ops-research-tool
git status
```

If anything is uncommitted (e.g., last-minute CSS tweaks during QA), commit it:

```powershell
git add -A
git commit -m "fix(sidebar): QA cleanup for edit-modal redesign"
```

Then push:

```powershell
git push
```

GitHub Actions will redeploy the GAS Web App per CLAUDE.md §11. Confirm the Actions tab shows a green deploy.

---

## Self-Review (already run before delivery)

- **Spec coverage:** every section of the spec maps to a task — §1-3 set the goal (covered by all tasks collectively); §4 architecture lives in the file structure block; §5 sidebar changes split between Task 11 (additions), Task 12 (polling), Task 13 (removals); §6 modal lives in Tasks 3-10; §7 server endpoints in Tasks 1-2; §8 polling protocol in Task 12; §9-10 error handling embedded in Tasks 4-10; §11 testing in Task 1 (server) + Task 14 (manual); §12 file map matches the File Structure block; §13 out-of-scope reminders honored (no MLA/extension/storage changes proposed).
- **Placeholder scan:** no TBDs, no "implement later", no naked "handle errors" — every step has either exact code or exact verification expectations.
- **Type consistency:** state field names (`modalOpenForSourceId`, `lastDataJson`, `pollHandle`, `pollUnchangedTicks`, `editor.confirmingHighlightDeleteId`, `editor.confirmingSourceDelete`) used identically across Tasks 3-12. Function names (`saveSourcePatch_`, `saveHighlightPatch_`, `optimisticallyDeleteHighlight_`, `colorForLabel_`) match between sidebar and modal where shared. Server endpoint names (`sidebarOpenSourceEditor`, `sidebarDeleteSource`, `sidebarUpdateSource`, `sidebarUpdateHighlight`, `sidebarDeleteHighlight`, `sidebarGetProjectData`, `sidebarPreviewCitation`) used consistently.
