# Extension Sidebar Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-tab (Source / Annotations) layout to the Chrome extension's in-page sidebar — letting students edit citation fields and primary/secondary classification on the page — replace the bulky wrapping filter pills with a compact vertical facet list, and replace the silent source-cascade on last-note deletion with a confirm-toast.

**Architecture:** The backend already supports everything needed except two tiny additions (a read-only `previewCitation` GET and a `kind:'source'` branch in the delete handler); `upsertSource_`'s existing field-merge already lets the extension write citation edits without scrape re-asserts clobbering them. Work splits into three file-isolated tracks that run in parallel (GAS backend, the extension service worker, the extension sidebar UI), then a short integration + QA pass.

**Tech Stack:** Google Apps Script (V8) backend; vanilla JS MV3 Chrome extension (no bundler, edit-and-reload — CLAUDE.md §6); clasp for GAS push. Reference design: [`docs/superpowers/specs/2026-05-29-extension-sidebar-refresh-design.md`](../specs/2026-05-29-extension-sidebar-refresh-design.md).

---

## Parallelization

Three tracks touch **disjoint files**, so they can be built concurrently with zero merge conflict. Track C consumes the message/endpoint contracts that A and B expose, but those contracts are fully specified below — so C codes against them immediately and a final integration task (Task INT) wires reality.

| Track | Owner files | Depends on | Can start |
| --- | --- | --- | --- |
| **A — GAS backend** | `apps-script/src/30_endpoints.js`, `apps-script/src/99_dev.js` | nothing | immediately |
| **B — service worker** | `extension/background.js` | nothing | immediately |
| **C — sidebar UI** | `extension/content/sidebar.js` | A + B *contracts* (documented here) | immediately |
| **INT — integrate + QA** | none (push + manual) | A, B, C all merged | after A+B+C |

**Critical path is Track C** (sidebar.js is the largest surface and all UI tasks within it are sequential — same file). A and B are smaller and finish first, de-risking C's integration. If dispatching subagents: **launch A, B, and C in parallel**; run **INT** once all three land.

**Contracts the tracks agree on (so C needn't wait for A/B):**

- **`previewCitation` (A1 / B4):** `apiGet({ action:'previewCitation', fields: <JSON string>, style:'mla' })` → `{ ok, text, italics }`. Proxied for content scripts via message `{ type:'previewCitation', fields, style }`.
- **canonical source on page load (B1):** `loadPageHighlights` response gains `source: <raw source row | null>`.
- **`enqueueSourcePatch` (B2):** message `{ type:'enqueueSourcePatch', source: <full source object> }` → `{ ok:true }`. The `source` object carries `sourceId, rawUrl, normalizedUrl?, accessDate?, scrapedTitle, scrapedSite, scrapedDate, scrapedAuthor, scrapedExtra, sourceType, citationFields, primarySecondary, annotation`.
- **`deleteSource` (B5 / A2):** message `{ type:'deleteSource', sourceId }` → `{ ok:true }`; drains to POST `deletes:[{kind:'source', id}]`.

**Testing model (honors CLAUDE.md §5/§6 over default TDD):** GAS logic is covered by editor-callable `devTest*` functions (red→green). The extension service worker + content script have **no unit-test runner in this repo** (vanilla JS, no bundler), so those tasks are *implement + structured manual QA* (load unpacked, reload, observe console/UI). Don't fabricate a JS test harness.

**Running GAS tests/pushes** (CLAUDE.md §8) — every PowerShell call first refreshes PATH:
```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\Users\paul.ivers\Desktop\ops-research-tool\apps-script
clasp push -f
```
Then run the named `devTest*` from the GAS editor and read the execution log.

---

## Track A — GAS backend

### Task A1: `previewCitation` GET endpoint

**Files:**
- Modify: `apps-script/src/30_endpoints.js` (the `handleGet_` switch, after the `findSource` case ~line 149)
- Test: `apps-script/src/99_dev.js` (new `devTestPreviewCitation`)

- [ ] **Step 1: Write the failing test** — add to `99_dev.js`:

```javascript
/**
 * previewCitation GET delegates to the MLA formatter and returns
 * { ok, text, italics }. Single source of truth — the extension Source tab
 * renders this rather than forking the formatter.
 */
function devTestPreviewCitation() {
  const fields = {
    sourceType: 'website',
    title: 'The Role of Technology in Blended Learning',
    siteName: 'Journal of Language and Education',
    author: 'Hekmat, Ali Mohammad',
    publishedDate: '2023',
    url: 'https://example.org/blended-learning',
  };
  const resp = handleGet_({ parameter: {
    action: 'previewCitation',
    fields: JSON.stringify(fields),
    style: 'mla',
  } });
  let pass = 0, fail = 0;
  const check = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };
  check('resp.ok', resp && resp.ok === true);
  check('text non-empty', resp && typeof resp.text === 'string' && resp.text.length > 0);
  check('italics is array', resp && Array.isArray(resp.italics));
  console.log(fail === 0 ? 'devTestPreviewCitation: ALL GREEN — ' + (resp && resp.text) : 'devTestPreviewCitation: NOT GREEN (' + fail + ' fail)');
}
```

- [ ] **Step 2: Run it to verify it fails** — `clasp push -f`, run `devTestPreviewCitation` in the editor.
Expected: logs `FAIL resp.ok` and `NOT GREEN` (action is `Unknown action previewCitation`).

- [ ] **Step 3: Implement the endpoint** — in `30_endpoints.js` `handleGet_`, add a case immediately after the `findSource` case:

```javascript
      case 'previewCitation': {
        if (!params.fields) throw new Error('fields required');
        const fields = JSON.parse(params.fields);
        const formatted = formatCitation(fields, params.style || 'mla');
        return { ok: true, text: formatted.text, italics: formatted.italics };
      }
```

- [ ] **Step 4: Run it to verify it passes** — `clasp push -f`, run `devTestPreviewCitation`.
Expected: `ALL GREEN` plus the formatted citation text.

- [ ] **Step 5: Commit**

```powershell
cd C:\Users\paul.ivers\Desktop\ops-research-tool
git add apps-script/src/30_endpoints.js apps-script/src/99_dev.js
git commit -m "feat(gas): previewCitation GET endpoint for extension Source tab"
```

---

### Task A2: `kind:'source'` delete branch in `doPost`

**Files:**
- Modify: `apps-script/src/30_endpoints.js` (`handlePost_` deletes loop, lines 65-77)
- Test: `apps-script/src/99_dev.js` (new `devTestSourceDeleteViaPost`)

- [ ] **Step 1: Write the failing test** — add to `99_dev.js`:

```javascript
/**
 * doPost deletes accept { kind:'source', id } and route to the orphan-safe
 * deleteSourceIfOrphaned_ — removes a source with no referencing highlights,
 * refuses one that still has evidence. Backs the extension's "Delete source"
 * toast action.
 */
function devTestSourceDeleteViaPost() {
  const project = devSeedDevProject();
  const me = Session.getEffectiveUser().getEmail();
  const ss = findOrCreateStudentSheet_(me, project);

  const orphanId = uuid_();
  const referencedId = uuid_();
  const hlId = uuid_();
  upsertSource_(ss, { sourceId: orphanId, projectId: project.projectId, rawUrl: 'https://orphan.example.com/x', scrapedTitle: 'Orphan', createdByEmail: me });
  upsertSource_(ss, { sourceId: referencedId, projectId: project.projectId, rawUrl: 'https://ref.example.com/x', scrapedTitle: 'Referenced', createdByEmail: me });
  upsertHighlight_(ss, { highlightId: hlId, sourceId: referencedId, projectId: project.projectId, primaryCategory: 'Background', highlightedText: 'keep me', createdByEmail: me });

  const post = (deletes) => handlePost_({ postData: { contents: JSON.stringify({ projectId: project.projectId, deletes }) } });
  const r1 = post([{ kind: 'source', id: orphanId }]);
  const r2 = post([{ kind: 'source', id: referencedId }]);

  const sourcesAfter = readSourcesForActor_(me, project.projectId);
  let pass = 0, fail = 0;
  const check = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };
  check('orphan delete ok', r1 && r1.ok === true);
  check('orphan deleted.sources === 1', r1 && r1.deleted && r1.deleted.sources === 1);
  check('orphan row gone', !sourcesAfter.find((s) => s.sourceId === orphanId));
  check('referenced deleted.sources === 0', r2 && r2.deleted && r2.deleted.sources === 0);
  check('referenced row still present', !!sourcesAfter.find((s) => s.sourceId === referencedId));

  // Cleanup.
  deleteHighlightById_(ss, hlId);
  deleteSourceIfOrphaned_(ss, referencedId);
  console.log(fail === 0 ? 'devTestSourceDeleteViaPost: ALL GREEN' : 'devTestSourceDeleteViaPost: NOT GREEN (' + fail + ' fail)');
}
```

- [ ] **Step 2: Run it to verify it fails** — `clasp push -f`, run `devTestSourceDeleteViaPost`.
Expected: `FAIL orphan deleted.sources === 1` (the `kind:'source'` branch doesn't exist, so the orphan isn't removed).

- [ ] **Step 3: Implement the branch** — in `30_endpoints.js` `handlePost_`, replace the `deletes.forEach((d) => {` block body so it also handles `source`:

```javascript
    deletes.forEach((d) => {
      try {
        if (d.kind === 'highlight') {
          const removedSourceId = deleteHighlightById_(studentSheet, d.id);
          if (removedSourceId !== null) deletedHighlights++;
          if (d.cascadeSource && removedSourceId) {
            if (deleteSourceIfOrphaned_(studentSheet, removedSourceId)) deletedSources++;
          }
        } else if (d.kind === 'source') {
          // Orphan-safe: deleteSourceIfOrphaned_ refuses if highlights still
          // reference it. Backs the extension's last-note "Delete source" toast.
          if (deleteSourceIfOrphaned_(studentSheet, d.id)) deletedSources++;
        }
      } catch (err) {
        errors.push({ kind: 'delete', id: d.id, error: String(err) });
      }
    });
```

- [ ] **Step 4: Run it to verify it passes** — `clasp push -f`, run `devTestSourceDeleteViaPost`.
Expected: `ALL GREEN`.

- [ ] **Step 5: Commit**

```powershell
git add apps-script/src/30_endpoints.js apps-script/src/99_dev.js
git commit -m "feat(gas): doPost handles kind:'source' deletes (orphan-safe)"
```

---

### Task A3: Regression-lock — citation survives a scrape re-assert

**Files:**
- Test only: `apps-script/src/99_dev.js` (new `devTestCitationSurvivesReassert`). No implementation change — `upsertSource_`'s merge already does this; this test **locks** it for the new extension write path.

- [ ] **Step 1: Write the test** — add to `99_dev.js`:

```javascript
/**
 * Locks the invariant the extension Source tab depends on: a citation write
 * (citationFields + sourceType + primarySecondary + annotation) survives a
 * later scrape-only re-assert (the shape getOrCreateSourceId enqueues, which
 * omits those keys). If this ever goes red, the extension's citation edits are
 * being clobbered by re-highlighting.
 */
function devTestCitationSurvivesReassert() {
  const project = devSeedDevProject();
  const me = Session.getEffectiveUser().getEmail();
  const ss = findOrCreateStudentSheet_(me, project);

  const sid = uuid_();
  // 1) Citation write (as the Source tab will send).
  upsertSource_(ss, {
    sourceId: sid, projectId: project.projectId, rawUrl: 'https://reassert.example.com/x',
    scrapedTitle: 'Scraped Title', createdByEmail: me,
    sourceType: 'article', primarySecondary: 'primary', annotation: 'My annotation.',
    citationFields: { sourceType: 'article', title: 'Edited Title', author: 'Doe, Jane' },
  });
  // 2) Scrape-only re-assert (as getOrCreateSourceId enqueues — no citation keys).
  upsertSource_(ss, {
    sourceId: sid, projectId: project.projectId, rawUrl: 'https://reassert.example.com/x',
    scrapedTitle: 'Scraped Title v2', scrapedAuthor: 'Scraper', createdByEmail: me,
    scrapedExtra: { publication: 'Some Journal' },
  });

  const src = readSourcesForActor_(me, project.projectId).find((s) => s.sourceId === sid);
  const cf = src ? JSON.parse(src.citationFields || '{}') : {};
  let pass = 0, fail = 0;
  const check = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };
  check('citationFields preserved', cf.title === 'Edited Title' && cf.author === 'Doe, Jane');
  check('sourceType preserved', src && src.sourceType === 'article');
  check('primarySecondary preserved', src && src.primarySecondary === 'primary');
  check('annotation preserved', src && src.annotation === 'My annotation.');
  check('scraped fields refreshed', src && src.scrapedTitle === 'Scraped Title v2');

  deleteSourceIfOrphaned_(ss, sid);
  console.log(fail === 0 ? 'devTestCitationSurvivesReassert: ALL GREEN' : 'devTestCitationSurvivesReassert: NOT GREEN (' + fail + ' fail)');
}
```

- [ ] **Step 2: Run it** — `clasp push -f`, run `devTestCitationSurvivesReassert`.
Expected: `ALL GREEN` on first run (the merge already exists). If red, stop and fix `upsertSource_` — the design depends on this.

- [ ] **Step 3: Commit**

```powershell
git add apps-script/src/99_dev.js
git commit -m "test(gas): lock citation-survives-scrape-reassert invariant"
```

---

## Track B — Extension service worker (`extension/background.js`)

> No unit-test runner; each task ends with a manual QA step and a commit. QA = reload the unpacked extension (`chrome://extensions` → reload), open the service-worker console, and exercise the path.
>
> **QA context note:** `chrome.runtime.sendMessage` only works from an *extension* context. To run the snippets below, open DevTools on any page where the extension's content script runs, then use the Console **context dropdown** to switch from "top" (the plain page) to the extension's content script — the plain page context has no `chrome.runtime`. The **service-worker** console (chrome://extensions → "service worker" → inspect) is for inspecting `chrome.storage.local`. If isolating B from C is awkward, these handlers are also fully exercised by the real UI at **Task INT** — it's fine to defer verification there.

### Task B1: `loadPageHighlights_` returns the canonical source

**Files:**
- Modify: `extension/background.js` `loadPageHighlights_` (~lines 208-260)

- [ ] **Step 1: Compute and return the canonical source.** The canonical (oldest matching) source is already sorted for the cache-seed; lift it to a function-scoped variable and add it to the return. Replace the cache-seed block + return with:

```javascript
    let canonicalSource = null;
    if (matching.length) {
      canonicalSource = matching.slice().sort((a, b) =>
        String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
      )[0];
      if (canonicalSource && canonicalSource.sourceId) {
        await setCachedSourceId(projectId, normalized, canonicalSource.sourceId);
      }
    }
    console.log('[OPS] loadPageHighlights:', {
      rawUrl, normalized,
      totalSources: allSources.length,
      totalHighlights: allHighlights.length,
      matchingSources: matching.length,
      matchingHighlights: highlights.length,
    });
    return { ok: true, highlights, sourceCount: matchingSourceIds.size, source: canonicalSource };
```

- [ ] **Step 2: QA.** Reload the extension. On a page where you've previously saved a highlight, in the service-worker console run:
```javascript
chrome.runtime.sendMessage({ type:'loadPageHighlights', rawUrl: location.href }, r => console.log(r))
```
Expected: response includes a `source` object with `citationFields`/`scrapedTitle`/`sourceId`. (Run from a normal page's devtools, not the SW console, since it needs a tab URL — or just confirm via the next track's integration.)

- [ ] **Step 3: Commit**

```powershell
git add extension/background.js
git commit -m "feat(ext): loadPageHighlights returns the canonical source row"
```

---

### Task B2: `enqueueSourcePatch` message handler

**Files:**
- Modify: `extension/background.js` (`handleMessage` switch + new function)

- [ ] **Step 1: Add the dispatch case** — in `handleMessage`, after the `enqueueHighlight` case:

```javascript
    case 'enqueueSourcePatch':
      return enqueueSourcePatch_(msg.source);
```

- [ ] **Step 2: Add the handler.** Place it near `enqueueSourceUpsert_`:

```javascript
/**
 * Persist a student's citation edits from the in-page Source tab. Sends a full
 * source upsert (scraped + citation fields) so no column blanks on the merge,
 * and routes through enqueueSourceUpsert_ so it coalesces with any pending
 * scrape re-assert for the same source.
 */
async function enqueueSourcePatch_(source) {
  const projectId = await getActiveProjectId();
  if (!projectId) throw new Error('No active project.');
  if (!source || !source.sourceId || !source.rawUrl) {
    throw new Error('source must have sourceId and rawUrl');
  }
  await enqueueSourceUpsert_({
    sourceId: source.sourceId,
    projectId,
    normalizedUrl: source.normalizedUrl || normalizeUrl(source.rawUrl),
    rawUrl: source.rawUrl,
    accessDate: source.accessDate || new Date().toISOString(),
    scrapedTitle: source.scrapedTitle || '',
    scrapedSite: source.scrapedSite || '',
    scrapedDate: source.scrapedDate || '',
    scrapedAuthor: source.scrapedAuthor || '',
    scrapedExtra: source.scrapedExtra || null,
    // The Source tab always resolves these to concrete values, so they're
    // never empty here — safe to send (upsertSource_ takes the provided value).
    sourceType: source.sourceType || '',
    citationFields: source.citationFields || null,
    primarySecondary: source.primarySecondary || 'unset',
    annotation: source.annotation || '',
  });
  return { ok: true };
}
```

- [ ] **Step 3: QA.** Reload. In a page console:
```javascript
chrome.runtime.sendMessage({ type:'enqueueSourcePatch', source:{ sourceId:'TEST', rawUrl:'https://x.test/a', citationFields:{ title:'T' } } }, r => console.log(r))
```
Expected: `{ ok:true }` and a `q:<uuid>` item appears in `chrome.storage.local` (kind `source`). Remove the test item afterward.

- [ ] **Step 4: Commit**

```powershell
git add extension/background.js
git commit -m "feat(ext): enqueueSourcePatch — persist Source-tab citation edits"
```

---

### Task B3: Merge-coalesce pending source writes

**Files:**
- Modify: `extension/background.js` `enqueueSourceUpsert_` (~lines 321-330)

- [ ] **Step 1: Replace remove-then-enqueue with merge-then-enqueue:**

```javascript
async function enqueueSourceUpsert_(payload) {
  const all = await chrome.storage.local.get(null);
  const staleKeys = Object.keys(all).filter((k) =>
    k.startsWith(QUEUE_PREFIX) &&
    all[k] && all[k].kind === 'source' &&
    all[k].payload && all[k].payload.sourceId === payload.sourceId
  );
  // Merge any pending writes for this source, newest winning per key it
  // provides; keys it omits keep the prior pending value. Without this, a
  // scrape re-assert (no citation keys) would drop a not-yet-synced citation
  // edit, or vice-versa. In practice staleKeys.length is 0 or 1 because each
  // enqueue already coalesces.
  let merged = {};
  staleKeys.forEach((k) => { merged = Object.assign(merged, all[k].payload); });
  merged = Object.assign(merged, payload);
  if (staleKeys.length) await chrome.storage.local.remove(staleKeys);
  await enqueue('source', merged);
}
```

- [ ] **Step 2: QA.** Reload. In a page console, enqueue a citation patch then a scrape-shaped source for the same id, and confirm one merged queue item results with BOTH `citationFields` and the scraped fields:
```javascript
await chrome.runtime.sendMessage({ type:'enqueueSourcePatch', source:{ sourceId:'MERGE', rawUrl:'https://x.test/m', citationFields:{ title:'Edited' } } });
// then simulate a scrape re-assert by highlighting again on that page, or inspect storage:
chrome.storage.local.get(null, all => console.log(Object.values(all).filter(v=>v&&v.kind==='source'&&v.payload.sourceId==='MERGE')))
```
Expected: a single source item whose payload has `citationFields.title === 'Edited'`. Clean up the test item.

- [ ] **Step 3: Commit**

```powershell
git add extension/background.js
git commit -m "fix(ext): coalesce pending source writes by merge, not last-write-wins"
```

---

### Task B4: `previewCitation` proxy message

**Files:**
- Modify: `extension/background.js` (`handleMessage` switch + new function)

- [ ] **Step 1: Add the dispatch case** — after the `loadPageHighlights` case:

```javascript
    case 'previewCitation':
      return previewCitation_(msg.fields, msg.style);
```

- [ ] **Step 2: Add the handler:**

```javascript
/**
 * Proxy the read-only MLA preview to GAS. Content scripts can't call the API
 * directly (chrome.identity lives here). Returns { ok:false, error } on
 * network failure so the Source tab can fall back to "preview offline".
 */
async function previewCitation_(fields, style) {
  try {
    return await apiGet({ action: 'previewCitation', fields: JSON.stringify(fields || {}), style: style || 'mla' });
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}
```

- [ ] **Step 3: QA.** Reload. In a page console:
```javascript
chrome.runtime.sendMessage({ type:'previewCitation', fields:{ sourceType:'website', title:'Hello', author:'Doe, Jane', url:'https://x.test' }, style:'mla' }, r => console.log(r))
```
Expected: `{ ok:true, text:'…', italics:[…] }` (requires the A1 endpoint pushed; otherwise `{ok:false}` — fine until INT).

- [ ] **Step 4: Commit**

```powershell
git add extension/background.js
git commit -m "feat(ext): previewCitation proxy to GAS MLA formatter"
```

---

### Task B5: `deleteSource` message + drain mapping

**Files:**
- Modify: `extension/background.js` (`handleMessage` switch, new function, and the `drain` deletes mapping ~lines 76-83)

- [ ] **Step 1: Add the dispatch case** — after the `deleteHighlight` case:

```javascript
    case 'deleteSource':
      return deleteSourceRequest_(msg.sourceId);
```

- [ ] **Step 2: Add the handler** (place near `deleteHighlightRequest_`):

```javascript
/**
 * Enqueue a standalone source deletion (the last-note "Delete source" toast).
 * Orphan-safe on the server. Also clears any pageSource cache entry pointing at
 * the deleted source so a later highlight on that page mints a fresh source
 * rather than reusing a server-deleted id.
 */
async function deleteSourceRequest_(sourceId) {
  const projectId = await getActiveProjectId();
  if (!projectId) throw new Error('No active project.');
  if (!sourceId) throw new Error('sourceId required');
  await enqueue('deleteSource', { projectId, sourceId });
  const all = await chrome.storage.local.get(null);
  const toRemove = [];
  for (const k of Object.keys(all)) {
    if (k.startsWith(PAGE_SOURCE_PREFIX) && all[k] === sourceId) toRemove.push(k);
  }
  if (toRemove.length) await chrome.storage.local.remove(toRemove);
  return { ok: true };
}
```

- [ ] **Step 3: Map `deleteSource` queue items into the POST.** In `drain`, replace the `deletes` construction (the `.filter((b) => b.kind === 'deleteHighlight')...` block) with:

```javascript
        const deletes = batch
          .filter((b) => b.kind === 'deleteHighlight')
          .map((b) => ({
            kind: 'highlight',
            id: b.payload.highlightId,
            cascadeSource: b.payload.cascadeSource,
            sourceId: b.payload.sourceId,
          }))
          .concat(
            batch
              .filter((b) => b.kind === 'deleteSource')
              .map((b) => ({ kind: 'source', id: b.payload.sourceId }))
          );
```

- [ ] **Step 4: QA.** Reload. In a page console: `chrome.runtime.sendMessage({type:'deleteSource', sourceId:'NOPE'}, r=>console.log(r))` → `{ok:true}` and a `deleteSource` queue item appears, then drains (verify server log / that it disappears). Use a real orphan source id to see `deleted.sources` increment after INT.

- [ ] **Step 5: Commit**

```powershell
git add extension/background.js
git commit -m "feat(ext): deleteSource message + drain mapping to kind:'source'"
```

---

## Track C — Extension sidebar UI (`extension/content/sidebar.js`)

> All tasks edit the one file, so they're sequential. They consume the A/B contracts (above). No unit-test runner — each ends with manual QA + commit. Visual reference: the approved tabbed mockup (Source form + facet filter) and the design spec §4–§8.
>
> **Placement note (applies to every C task):** all new functions, consts, and module-level `let` timers below go **inside the `OpsSidebar` IIFE**, alongside the existing `renderEntry_` / `makeFilterChip_` / `el_` helpers — they reference closure state (`state`, `el_`, `render_`, `state.shadowRoot`) and will throw `ReferenceError` if hoisted to true module scope. `el_(tag, className, text)` is the existing helper: pass `null` for `className` when there isn't one.

### Task C1: Tab bar + `state.activeTab`

**Files:**
- Modify: `extension/content/sidebar.js` (CSS block, `state`, `renderPanel_`)

- [ ] **Step 1: Add tab-bar CSS.** Append to `SIDEBAR_CSS` (before the closing backtick):

```css
.tabs { display:flex; border-bottom:1px solid #e8eaed; padding:0 8px; gap:2px; }
.tab {
  flex:1; text-align:center; padding:10px 6px 8px; font-size:12.5px; font-weight:600;
  color:#80868b; background:none; border:none; border-bottom:2.5px solid transparent;
}
.tab--active { color:#1a73e8; border-bottom-color:#1a73e8; }
.tab__badge {
  display:inline-block; min-width:16px; padding:0 5px; margin-left:5px; font-size:10px;
  font-weight:700; line-height:16px; border-radius:999px; background:#eceff1; color:#5f6368;
}
.tab--active .tab__badge { background:#e8f0fe; color:#1a73e8; }
```

- [ ] **Step 2: Add `activeTab` to state.** In the `state` object literal, add:

```javascript
    activeTab: 'annotations', // 'source' | 'annotations'
```

- [ ] **Step 3: Render the tab bar and route content.** In `renderPanel_`, after the subheader (`state.panelEl.appendChild(sub);`) and before the filter row, insert the tab bar; then wrap the existing filter-row + list rendering so it only runs for the `annotations` tab, and render the source tab otherwise. Replace everything from the `// Filter row` comment through `state.panelEl.appendChild(state.listEl);` with:

```javascript
    // Tab bar
    const tabs = el_('div', 'tabs');
    const srcTab = el_('button', 'tab' + (state.activeTab === 'source' ? ' tab--active' : ''), 'Source');
    srcTab.type = 'button';
    srcTab.addEventListener('click', () => { state.activeTab = 'source'; render_(); });
    const annTab = el_('button', 'tab' + (state.activeTab === 'annotations' ? ' tab--active' : ''));
    annTab.type = 'button';
    annTab.appendChild(document.createTextNode('Annotations'));
    if (state.pageHighlights.length) {
      const badge = el_('span', 'tab__badge', String(state.pageHighlights.length));
      annTab.appendChild(badge);
    }
    annTab.addEventListener('click', () => { state.activeTab = 'annotations'; render_(); });
    tabs.appendChild(srcTab);
    tabs.appendChild(annTab);
    state.panelEl.appendChild(tabs);

    if (state.activeTab === 'source') {
      state.panelEl.appendChild(renderSourceTab_());
      return;
    }

    // ----- Annotations tab -----
    // Filter row
    if (state.bundle) {
      const filterRow = el_('div', 'filter-row');
      const allChip = makeFilterChip_(null, 'All', '#dadce0', countByCategory_(null));
      filterRow.appendChild(allChip);
      for (let i = 1; i <= 5; i++) {
        const label = state.bundle['label' + i];
        const color = state.bundle['color' + i];
        if (!label) continue;
        filterRow.appendChild(makeFilterChip_(label, label, color, countByCategory_(label)));
      }
      state.panelEl.appendChild(filterRow);
    }

    // List
    state.listEl = el_('div', 'list');
    const filtered = filteredHighlights_();
    if (filtered.length === 0) {
      const empty = el_('div', 'list__empty');
      empty.textContent = state.pageHighlights.length === 0
        ? 'Highlight some text on this page to start.'
        : 'No highlights match this filter.';
      state.listEl.appendChild(empty);
    } else {
      filtered.forEach((h) => state.listEl.appendChild(renderEntry_(h)));
    }
    state.panelEl.appendChild(state.listEl);
```

- [ ] **Step 4: Add a temporary `renderSourceTab_` stub** (replaced in C3) so the file runs:

```javascript
function renderSourceTab_() {
  return el_('div', 'list__empty', 'Source tab coming soon.');
}
```

- [ ] **Step 5: QA.** Reload, open the sidebar on a page with highlights. Expected: a Source / Annotations tab bar; Annotations is active by default and shows today's list + filter; clicking Source shows the stub; the count badge matches the highlight count; switching tabs preserves list scroll within Annotations.

- [ ] **Step 6: Commit**

```powershell
git add extension/content/sidebar.js
git commit -m "feat(ext): Source/Annotations tab bar in the in-page sidebar"
```

---

### Task C2: Vertical facet-list filter (replaces wrapping pills)

**Files:**
- Modify: `extension/content/sidebar.js` (CSS, the Annotations filter-row block from C1, and a new `renderFacetList_`)

- [ ] **Step 1: Add facet-list CSS.** Append to `SIDEBAR_CSS`:

```css
.facets { padding:6px 8px 8px; border-bottom:1px solid #f1f3f4; }
.facet {
  display:flex; align-items:center; gap:9px; width:100%; padding:5px 8px; border:none;
  background:none; border-radius:6px; font-size:12px; color:#3c4043; text-align:left;
}
.facet:hover { background:#f8f9fa; }
.facet--all { font-weight:600; margin-bottom:2px; }
.facet--active { background:#e8f0fe; color:#1a73e8; font-weight:600; }
.facet--zero { opacity:0.42; }
.facet__dot { width:11px; height:11px; border-radius:3px; flex:0 0 auto; }
.facet__lab { flex:1; }
.facet__count { color:#9aa0a6; font-variant-numeric:tabular-nums; }
.facet--active .facet__count { color:#1a73e8; }
```

- [ ] **Step 2: Add `renderFacetList_`** (reuses `state.filter`, `countByCategory_`):

```javascript
function renderFacetList_() {
  const wrap = el_('div', 'facets');

  // "All notes" row.
  const all = el_('button', 'facet facet--all' + (state.filter === null ? ' facet--active' : ''));
  all.type = 'button';
  all.appendChild(el_('span', 'facet__lab', 'All notes'));
  all.appendChild(el_('span', 'facet__count', String(countByCategory_(null))));
  all.addEventListener('click', () => { state.filter = null; render_(); });
  wrap.appendChild(all);

  // One row per category, in bundle (timeline) order; zero-count rows dimmed.
  for (let i = 1; i <= 5; i++) {
    const label = state.bundle['label' + i];
    const color = state.bundle['color' + i];
    if (!label) continue;
    const count = countByCategory_(label);
    const active = state.filter === label;
    const row = el_('button', 'facet' + (active ? ' facet--active' : '') + (count === 0 ? ' facet--zero' : ''));
    row.type = 'button';
    const dot = el_('span', 'facet__dot');
    dot.style.backgroundColor = color;
    row.appendChild(dot);
    row.appendChild(el_('span', 'facet__lab', label));
    row.appendChild(el_('span', 'facet__count', String(count)));
    row.addEventListener('click', () => { state.filter = active ? null : label; render_(); });
    wrap.appendChild(row);
  }
  return wrap;
}
```

- [ ] **Step 3: Swap the pill filter for the facet list.** In `renderPanel_`'s Annotations branch, replace the entire `// Filter row` block (the `if (state.bundle) { ... filterRow ... }`) with:

```javascript
    if (state.bundle) state.panelEl.appendChild(renderFacetList_());
```

- [ ] **Step 4: Remove the now-dead `.filter-row` / `.filter-chip*` CSS rules** from `SIDEBAR_CSS` (they're only used by the removed pill filter; `makeFilterChip_` is no longer called — delete it too). Leave `.entry__alt-pill*` rules intact (those are the per-entry secondary picker, still used).

- [ ] **Step 5: QA.** Reload, open the Annotations tab. Expected: a vertical list — "All notes (n)" then the 5 categories in timeline order with swatch · label · count; zero-count categories dimmed; clicking a row filters; clicking the active row or "All notes" clears; selection styling matches.

- [ ] **Step 6: Commit**

```powershell
git add extension/content/sidebar.js
git commit -m "feat(ext): replace wrapping filter pills with vertical facet list"
```

---

### Task C3: Source tab — data + citation form + autosave

**Files:**
- Modify: `extension/content/sidebar.js` (CSS, `state`, `loadForCurrentPage`, the toolbar source-id backfill, and `renderSourceTab_`)

- [ ] **Step 1: Add `state.pageSource`.** In `state`, add:

```javascript
    pageSource: null, // canonical source object for this page (server + local scrape)
```

- [ ] **Step 2: Populate `pageSource` from the server load.** In `loadForCurrentPage`, after the `resp = await chrome.runtime.sendMessage({ type: 'loadPageHighlights', ... })` succeeds and before/after the highlight merge, capture the source:

```javascript
    if (resp && resp.ok && resp.source) {
      state.pageSource = normalizeSourceObj_(resp.source);
    }
```

Add the helper (parses the raw JSON columns the GET returns):

```javascript
function normalizeSourceObj_(s) {
  if (!s) return null;
  const parse = (v) => { try { return v ? JSON.parse(v) : null; } catch (_) { return null; } };
  return {
    sourceId: s.sourceId,
    projectId: s.projectId,
    normalizedUrl: s.normalizedUrl || '',
    rawUrl: s.rawUrl || '',
    accessDate: s.accessDate || '',
    scrapedTitle: s.scrapedTitle || '',
    scrapedSite: s.scrapedSite || '',
    scrapedDate: s.scrapedDate || '',
    scrapedAuthor: s.scrapedAuthor || '',
    scrapedExtra: parse(s.scrapedExtra) || {},
    sourceType: s.sourceType || '',
    citationFields: parse(s.citationFields) || {},
    primarySecondary: s.primarySecondary || 'unset',
    annotation: s.annotation || '',
  };
}
```

- [ ] **Step 3: Seed `pageSource` for a just-highlighted page.** The toolbar backfills the sourceId via `OpsSidebar._setSourceId`. Extend `_setSourceId` to also seed a minimal `pageSource` from the scrape if none exists yet, so the Source tab works before the server row syncs. Replace `_setSourceId` with:

```javascript
  function _setSourceId(highlightId, sourceId, scrape) {
    const h = state.pageHighlights.find((x) => x.highlightId === highlightId);
    if (h) h.sourceId = sourceId;
    if (!state.pageSource && sourceId) {
      const sc = scrape || {};
      state.pageSource = {
        sourceId,
        projectId: state.project ? state.project.projectId : '',
        normalizedUrl: '',
        rawUrl: location.href,
        accessDate: new Date().toISOString(),
        scrapedTitle: sc.title || '',
        scrapedSite: sc.site || '',
        scrapedDate: sc.date || '',
        scrapedAuthor: sc.author || '',
        scrapedExtra: { publication: sc.publication, publisher: sc.publisher, volume: sc.volume, issue: sc.issue, pages: sc.pages, sourceType: sc.sourceType },
        sourceType: sc.sourceType || '',
        citationFields: {},
        primarySecondary: 'unset',
        annotation: '',
      };
    }
  }
```

> Note for INT: `toolbar.js` calls `_setSourceId(highlightId, sourceId)` today — INT Step adds the `scrape` arg. If C is built before INT, the seed simply won't fire until the arg is wired; the server-load path (Step 2) still populates it on reload.

- [ ] **Step 4: Add the Source-form CSS.** Append to `SIDEBAR_CSS`:

```css
.src { padding:10px 14px 16px; overflow-y:auto; }
.src__empty { padding:24px 14px; text-align:center; color:#5f6368; font-size:12px; line-height:1.5; }
.src__fld { margin-bottom:9px; }
.src__fld label { display:block; font-size:10px; text-transform:uppercase; letter-spacing:0.04em; color:#80868b; margin-bottom:3px; }
.src__fld input, .src__fld select {
  width:100%; border:1px solid #dadce0; border-radius:6px; padding:6px 8px; font:inherit; font-size:12.5px; color:#202124; background:#fff;
}
.src__seg { display:flex; border:1px solid #dadce0; border-radius:7px; overflow:hidden; }
.src__seg button { flex:1; border:none; border-right:1px solid #eceff1; background:#fff; padding:7px 4px; font-size:12px; color:#5f6368; }
.src__seg button:last-child { border-right:none; }
.src__seg button.src__seg--on { background:#e8f0fe; color:#1a73e8; font-weight:600; }
.src__ta { width:100%; border:1px solid #dadce0; border-radius:6px; padding:6px 8px; font:inherit; font-size:12.5px; min-height:48px; resize:vertical; }
.src__preview { margin-top:10px; padding:9px 11px; background:#f8f9fa; border:1px solid #eceff1; border-radius:7px; font-size:11.5px; line-height:1.5; color:#3c4043; }
.src__preview-lbl { display:block; font-size:9.5px; text-transform:uppercase; letter-spacing:0.05em; color:#9aa0a6; margin-bottom:3px; }
.src__status { font-size:10.5px; color:#0f9d58; margin-top:8px; min-height:14px; }
.src__status--pending { color:#b06000; }
.src__status--error { color:#d93025; }
```

- [ ] **Step 5: Replace the `renderSourceTab_` stub** with the real form. This mirrors the Docs editor's field set + precedence:

```javascript
const SRC_TYPES = ['website', 'article', 'book', 'primary'];
const PS_OPTS = ['primary', 'secondary', 'unset'];

function sourceFieldsFor_(sourceType) {
  switch (sourceType) {
    case 'website': return [
      { key:'title', label:'Title' }, { key:'siteName', label:'Site name' },
      { key:'author', label:'Author' }, { key:'publishedDate', label:'Published date' },
      { key:'url', label:'URL' }];
    case 'article': return [
      { key:'title', label:'Article title' }, { key:'publication', label:'Publication name' },
      { key:'author', label:'Author' }, { key:'publishedDate', label:'Published date' },
      { key:'volume', label:'Volume (opt.)' }, { key:'issue', label:'Issue (opt.)' },
      { key:'pages', label:'Pages (opt.)' }, { key:'url', label:'URL' }];
    case 'book': return [
      { key:'title', label:'Book title' }, { key:'author', label:'Author' },
      { key:'publisher', label:'Publisher' }, { key:'publishedDate', label:'Year' }];
    case 'primary': return [
      { key:'title', label:'Title' }, { key:'author', label:'Author / creator' },
      { key:'publishedDate', label:'Date' }, { key:'archive', label:'Archive / repository' },
      { key:'url', label:'URL' }];
    default: return [];
  }
}

// Effective field values: student-entered citationFields win, then the rich
// scrape, then defaults. Mirrors source_editor_js.html renderCitationForm.
function effectiveFields_(src) {
  const extra = src.scrapedExtra || {};
  const f = Object.assign({}, src.citationFields || {});
  f.sourceType    = f.sourceType    || src.sourceType || extra.sourceType || 'website';
  f.title         = f.title         || src.scrapedTitle || '';
  f.siteName      = f.siteName      || src.scrapedSite || '';
  f.publishedDate = f.publishedDate || src.scrapedDate || '';
  f.author        = f.author        || src.scrapedAuthor || '';
  f.publication   = f.publication   || extra.publication || '';
  f.publisher     = f.publisher     || extra.publisher || '';
  f.volume        = f.volume        || extra.volume || '';
  f.issue         = f.issue         || extra.issue || '';
  f.pages         = f.pages         || extra.pages || '';
  f.url           = f.url           || src.rawUrl || '';
  return f;
}

function renderSourceTab_() {
  if (!state.pageSource) {
    return el_('div', 'src__empty', 'Highlight something on this page to start its citation.');
  }
  const src = state.pageSource;
  const fields = effectiveFields_(src);
  src.citationFields = fields; // persist resolved values so edits build on them
  src.sourceType = fields.sourceType;

  const form = el_('div', 'src');

  // Source type
  const typeWrap = el_('div', 'src__fld');
  typeWrap.appendChild(el_('label', null, 'Source type'));
  const sel = document.createElement('select');
  SRC_TYPES.forEach((t) => {
    const o = document.createElement('option'); o.value = t; o.textContent = t;
    if (t === fields.sourceType) o.selected = true; sel.appendChild(o);
  });
  sel.addEventListener('change', () => {
    fields.sourceType = sel.value; src.sourceType = sel.value;
    saveSource_(); render_(); // re-render to swap the field set
  });
  typeWrap.appendChild(sel);
  form.appendChild(typeWrap);

  // Per-type fields
  sourceFieldsFor_(fields.sourceType).forEach((def) => {
    const wrap = el_('div', 'src__fld');
    wrap.appendChild(el_('label', null, def.label));
    const inp = document.createElement('input');
    inp.type = 'text'; inp.value = fields[def.key] || '';
    const commit = () => { fields[def.key] = inp.value; saveSource_(); schedulePreview_(); };
    inp.addEventListener('change', commit);
    inp.addEventListener('blur', commit);
    wrap.appendChild(inp);
    form.appendChild(wrap);
  });

  // Primary/Secondary segmented control
  const tagWrap = el_('div', 'src__fld');
  tagWrap.appendChild(el_('label', null, 'Tag'));
  const seg = el_('div', 'src__seg');
  PS_OPTS.forEach((opt) => {
    const b = el_('button', 'src__seg' + ((src.primarySecondary || 'unset') === opt ? ' src__seg--on' : ''), opt[0].toUpperCase() + opt.slice(1));
    b.type = 'button';
    b.addEventListener('click', () => { src.primarySecondary = opt; saveSource_(); render_(); });
    seg.appendChild(b);
  });
  tagWrap.appendChild(seg);
  form.appendChild(tagWrap);

  // Annotation
  const annWrap = el_('div', 'src__fld');
  annWrap.appendChild(el_('label', null, 'Annotation'));
  const ta = document.createElement('textarea');
  ta.className = 'src__ta'; ta.value = src.annotation || '';
  ta.placeholder = '2–3 sentence annotation…';
  let annTimer;
  ta.addEventListener('input', () => {
    clearTimeout(annTimer);
    src.annotation = ta.value;
    annTimer = setTimeout(() => saveSource_(), 600);
  });
  annWrap.appendChild(ta);
  form.appendChild(annWrap);

  // Live preview (C4 wires the network call; container + initial paint here)
  const preview = el_('div', 'src__preview');
  preview.id = 'ops-src-preview';
  preview.innerHTML = '<span class="src__preview-lbl">MLA preview</span><em>…</em>';
  form.appendChild(preview);

  // Save status
  const status = el_('div', 'src__status' + (state.sourceSaveStatus ? ' src__status--' + state.sourceSaveStatus : ''));
  status.textContent = { pending: 'saving…', saved: '✓ saved', error: '⚠ save failed' }[state.sourceSaveStatus] || '';
  form.appendChild(status);

  schedulePreview_();
  return form;
}

// Debounced autosave of the whole source via the service worker.
let _srcSaveTimer = null;
function saveSource_() {
  if (!state.pageSource) return;
  state.sourceSaveStatus = 'pending';
  const statusEl = state.shadowRoot && state.shadowRoot.querySelector('.src__status');
  if (statusEl) { statusEl.textContent = 'saving…'; statusEl.className = 'src__status src__status--pending'; }
  clearTimeout(_srcSaveTimer);
  const snapshot = JSON.parse(JSON.stringify(state.pageSource));
  _srcSaveTimer = setTimeout(() => {
    chrome.runtime.sendMessage({ type: 'enqueueSourcePatch', source: snapshot })
      .then(() => { state.sourceSaveStatus = 'saved'; paintSourceStatus_(); })
      .catch(() => { state.sourceSaveStatus = 'error'; paintSourceStatus_(); });
  }, 500);
}
function paintSourceStatus_() {
  const el = state.shadowRoot && state.shadowRoot.querySelector('.src__status');
  if (!el) return;
  el.className = 'src__status' + (state.sourceSaveStatus ? ' src__status--' + state.sourceSaveStatus : '');
  el.textContent = { pending: 'saving…', saved: '✓ saved', error: '⚠ save failed' }[state.sourceSaveStatus] || '';
}
```

Add `sourceSaveStatus: null,` to `state`. Add a no-op `schedulePreview_` stub now (C4 fills it):

```javascript
function schedulePreview_() { /* wired in C4 */ }
```

- [ ] **Step 6: QA.** Reload. On a page, highlight something, open the sidebar → Source tab. Expected: the citation form shows scraped values pre-filled; changing the source type swaps the field set; editing a field shows "saving…" then "✓ saved"; the Primary/Secondary control persists; reloading the page repopulates the edits from the server. (Preview shows "…" until C4.)

- [ ] **Step 7: Commit**

```powershell
git add extension/content/sidebar.js
git commit -m "feat(ext): Source tab citation form with autosave (mirrors Docs editor)"
```

---

### Task C4: Source tab — live MLA preview

**Files:**
- Modify: `extension/content/sidebar.js` (`schedulePreview_`)

- [ ] **Step 1: Replace the `schedulePreview_` stub** with the real debounced call:

```javascript
let _previewTimer = null;
function schedulePreview_() {
  clearTimeout(_previewTimer);
  _previewTimer = setTimeout(renderPreviewNow_, 350);
}
function renderPreviewNow_() {
  if (!state.pageSource) return;
  const el = state.shadowRoot && state.shadowRoot.querySelector('#ops-src-preview');
  if (!el) return;
  const fields = effectiveFields_(state.pageSource);
  chrome.runtime.sendMessage({ type: 'previewCitation', fields, style: 'mla' })
    .then((res) => {
      const cur = state.shadowRoot && state.shadowRoot.querySelector('#ops-src-preview');
      if (!cur) return;
      if (!res || !res.ok) {
        cur.innerHTML = '<span class="src__preview-lbl">MLA preview</span><em>Preview updates when you\'re back online.</em>';
        return;
      }
      cur.innerHTML = '<span class="src__preview-lbl">MLA preview</span>' + previewHtml_(res.text || '', res.italics || []);
    })
    .catch(() => {});
}
function previewHtml_(text, italics) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = '', cursor = 0;
  italics.forEach(([s, e]) => {
    if (s > cursor) html += esc(text.slice(cursor, s));
    html += '<em>' + esc(text.slice(s, e)) + '</em>';
    cursor = e;
  });
  if (cursor < text.length) html += esc(text.slice(cursor));
  return html;
}
```

- [ ] **Step 2: QA.** (Requires A1 + B4 pushed/loaded.) Reload, open the Source tab, edit a field. Expected: the MLA preview updates ~0.35s after typing stops, with italics on the title/container; going offline shows the fallback line while fields still save.

- [ ] **Step 3: Commit**

```powershell
git add extension/content/sidebar.js
git commit -m "feat(ext): live MLA preview in the Source tab"
```

---

### Task C5: Orphan toast on last-note deletion

**Files:**
- Modify: `extension/content/sidebar.js` (CSS, `deleteHighlight_`, new toast helpers)

- [ ] **Step 1: Add toast CSS.** Append to `SIDEBAR_CSS`:

```css
.toast {
  position:absolute; left:12px; right:12px; bottom:12px; z-index:5;
  background:#202124; color:#fff; border-radius:8px; padding:10px 12px;
  box-shadow:0 4px 16px rgba(0,0,0,0.28); font-size:12px; line-height:1.4;
  display:flex; flex-direction:column; gap:8px;
}
.toast__actions { display:flex; gap:8px; justify-content:flex-end; }
.toast__btn { font:inherit; font-size:11px; padding:4px 10px; border-radius:5px; border:none; cursor:pointer; }
.toast__btn--keep { background:rgba(255,255,255,0.16); color:#fff; }
.toast__btn--delete { background:#f28b82; color:#202124; font-weight:600; }
```

The panel needs `position: relative` for the absolutely-positioned toast — confirm `.panel` has it; if not, add `position: relative;` to the `.panel` rule (it currently uses `position: fixed`, which already establishes a containing block, so no change needed).

- [ ] **Step 2: Make the delete no longer auto-cascade; show the toast on last-note.** Replace `deleteHighlight_` with:

```javascript
  async function deleteHighlight_(h) {
    const wasLastForSource = h.sourceId && !state.pageHighlights.some(
      (x) => x.highlightId !== h.highlightId && x.sourceId === h.sourceId
    );

    if (self.unwrapMark) self.unwrapMark(h.highlightId);
    const idx = state.pageHighlights.findIndex((x) => x.highlightId === h.highlightId);
    if (idx >= 0) state.pageHighlights.splice(idx, 1);
    if (state.editingId === h.highlightId) state.editingId = null;
    if (state.altPickerOpenId === h.highlightId) state.altPickerOpenId = null;
    state.confirmingDeleteId = null;
    if (state.confirmingDeleteTimer) { clearTimeout(state.confirmingDeleteTimer); state.confirmingDeleteTimer = null; }
    render_();

    try {
      // Never silently cascade now — the source may hold citation work. Delete
      // the highlight only; offer source removal via the toast below.
      await chrome.runtime.sendMessage({
        type: 'deleteHighlight',
        highlightId: h.highlightId,
        sourceId: h.sourceId || '',
        cascadeSource: false,
      });
    } catch (e) {
      console.warn('[OPS sidebar] delete failed:', e);
    }

    if (wasLastForSource) showOrphanToast_(h.sourceId);
  }
```

- [ ] **Step 3: Add the toast helpers:**

```javascript
  let _orphanToastTimer = null;
  function showOrphanToast_(sourceId) {
    dismissOrphanToast_();
    const toast = el_('div', 'toast');
    toast.appendChild(el_('div', null, 'Last note removed. Keep this source’s citation, or delete the source too?'));
    const actions = el_('div', 'toast__actions');
    const keep = el_('button', 'toast__btn toast__btn--keep', 'Keep');
    keep.type = 'button';
    keep.addEventListener('click', dismissOrphanToast_);
    const del = el_('button', 'toast__btn toast__btn--delete', 'Delete source');
    del.type = 'button';
    del.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'deleteSource', sourceId }).catch(() => {});
      if (state.pageSource && state.pageSource.sourceId === sourceId) state.pageSource = null;
      dismissOrphanToast_();
      render_();
    });
    actions.appendChild(keep);
    actions.appendChild(del);
    toast.appendChild(actions);
    state.panelEl.appendChild(toast);
    _orphanToastTimer = setTimeout(dismissOrphanToast_, 7000); // default = keep
  }
  function dismissOrphanToast_() {
    if (_orphanToastTimer) { clearTimeout(_orphanToastTimer); _orphanToastTimer = null; }
    const t = state.panelEl && state.panelEl.querySelector('.toast');
    if (t) t.remove();
  }
```

> Note: the toast is appended to `state.panelEl` directly so it survives the `render_()` that rebuilds the list. Because `render_()` rebuilds `panelEl.innerHTML`, call `showOrphanToast_` *after* the final `render_()` in `deleteHighlight_` (as written). The toast removes itself on action/timeout; a later `render_()` (e.g. switching tabs) will clear it too — acceptable.

- [ ] **Step 4: QA.** Reload. Highlight once on a page (one note, one source). Delete that note → Confirm. Expected: the note disappears and a dark toast slides in offering **Keep** / **Delete source**; Keep (or waiting ~7s) leaves the source (the Source tab still shows its citation); Delete source removes it (verify `deleted.sources` server-side after INT, and that re-highlighting the page mints a fresh source). Deleting a non-last note shows **no** toast.

- [ ] **Step 5: Commit**

```powershell
git add extension/content/sidebar.js
git commit -m "feat(ext): orphan-source confirm toast on last-note deletion"
```

---

## Task INT: Integration + full QA

**Files:**
- Modify: `extension/content/toolbar.js` (pass `scrape` to `_setSourceId`)
- Push: GAS (Track A); reload extension (Tracks B+C)

- [ ] **Step 1: Wire the scrape into the source seed.** In `toolbar.js`, find the `OpsSidebar._setSourceId(highlightId, sourceId)` call (after `getOrCreateSourceId` resolves) and pass the page scrape as the third arg, e.g.:

```javascript
OpsSidebar._setSourceId(highlightId, sourceId, scrape);
```

Use whatever local variable holds the scrape object already passed to `getOrCreateSourceId` in that function. Confirm by grepping:
```powershell
Select-String -Path extension\content\toolbar.js -Pattern "_setSourceId|getOrCreateSourceId|scrape"
```

- [ ] **Step 2: Push GAS and reload the extension.**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd C:\Users\paul.ivers\Desktop\ops-research-tool\apps-script
clasp push -f
```
Then `chrome://extensions` → reload the unpacked extension.

- [ ] **Step 3: GAS regression suite.** From the editor, run `devTestRoundTrip`, `devTestNormalizeUrl`, `devTestGroupsAll`, plus the three new tests `devTestPreviewCitation`, `devTestSourceDeleteViaPost`, `devTestCitationSurvivesReassert`. Expected: all `ALL GREEN` / `PASS`.

- [ ] **Step 4: End-to-end QA matrix.** On a free news article, an academic/database page, and the PDF panel:
  1. Highlight → Annotations tab shows the note; facet list shows counts and dims empty categories.
  2. Source tab pre-fills scraped fields; edit title/author/type; "✓ saved"; MLA preview updates.
  3. Reload the page → Source-tab edits persist (loaded from server); Annotations list persists.
  4. **Coalesce check:** edit a citation field, then immediately highlight again on the same page *before* the queue drains; reload → the citation edit survived (Task B3).
  5. **Toast check:** delete the only note → toast → "Delete source" → re-highlight mints a fresh source; separately, "Keep" → Source tab citation remains.

- [ ] **Step 5: Update CLAUDE.md.** Add the new `previewCitation` GET, the `kind:'source'` delete, and the three new `devTest*` to the relevant sections (§3 Phase 2, §8 test list, §4 decisions if warranted). Commit.

```powershell
cd C:\Users\paul.ivers\Desktop\ops-research-tool
git add CLAUDE.md
git commit -m "docs: record extension Source/Annotations tabs + new endpoints in CLAUDE.md"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** §4 tabs → C1; §5 Source tab/form/precedence → C3; §5.4 preview → A1+B4+C4; §6 data plumbing → B1/B2/C3; §6.3 coalesce → B3; §7 delete toast → C5+B5; §7.1 source delete → A2; §8 facet filter → C2; §10 tests → A1/A2/A3 + INT QA.
- **No new citation styles, no source switcher, no manual "save as source", no standalone delete-source button** — all honored (the Source tab has no delete button; deletion is toast-only).
- **`makeFilterChip_` removal:** C2 deletes it; confirm nothing else references it (grep before deleting).
- **Toolbar coupling:** the only cross-file change outside the three tracks is INT Step 1 (`_setSourceId` gains an optional 3rd arg, backward-compatible).
