# Extension sidebar refresh

**Date:** 2026-05-29
**Status:** Approved design — ready for implementation plan
**Scope:** Chrome extension in-page sidebar (Phase 2,
[`extension/content/sidebar.js`](../../../extension/content/sidebar.js)).
Four changes: (1) a two-tab layout (Source / Annotations); (2) a Source tab
that lets students view and edit citation fields + primary/secondary directly
in the extension; (3) replace the bulky wrapping filter pills with a compact
vertical facet list; (4) a confirm-toast when deleting a note would orphan its
source. No changes to the Docs sidebar (Phase 3) or the Teacher Console.

## 1. Problem

1. **The category filter is bulky and poorly organized.** Six pills (All + 5
   bundle categories), each carrying a colored dot, label, and count, wrap onto
   three rows inside the 360px panel. Weak hierarchy — "All" looks identical in
   weight to the categories.
2. **Students can only edit citation fields in the Docs sidebar.** Bibliography
   metadata (title, author, date, publication, etc.), source type, and the
   primary/secondary tag are all editable only from inside a Google Doc
   ([`source_editor_js.html`](../../../apps-script/src/source_editor_js.html)).
   During the research/highlighting phase — when the student is *on the source*
   — there is no way to see or correct what was scraped, or to classify the
   source as primary/secondary. That work is deferred to the writing phase,
   away from the page.
3. **Deleting the last note silently destroys the source.** Today,
   [`sidebar.js`](../../../extension/content/sidebar.js) `deleteHighlight_`
   computes `cascadeSource = !stillReferenced` and silently cascade-deletes the
   source when its last referencing highlight is removed. Once the Source tab
   lets a student invest real citation work, a silent cascade can wipe that
   work with no confirmation.

## 2. Goals

- Add a **Source** tab and an **Annotations** tab to the in-page sidebar.
- The Source tab mirrors the Docs editor's citation form exactly — same source
  types, same per-type fields, same primary/secondary control — so there is one
  citation mental model, not two.
- Edits autosave through the existing offline sync queue (no new "Save"
  button), and a scrape re-assert can never clobber a student's citation work.
- Replace the wrapping filter pills with a compact vertical facet list on the
  Annotations tab.
- Replace the silent source-cascade on last-note deletion with an explicit
  confirm-toast that defaults to keeping the source.

## 3. Non-goals (v1)

- **No manual "Save this page as a source."** Sources are minted only by
  highlighting, as today. The Source tab is reachable only once a source
  exists for the page.
- **No standalone "Delete source" button** in the Source tab. Source deletion
  happens only via the orphan toast (§7).
- **No per-page source switcher.** One page = one canonical source. (The rare
  duplicate-source window from the existing dedup design is unchanged; the tab
  edits the canonical — oldest — source.)
- **MLA only.** The live preview reuses the existing
  [`51_citation.js`](../../../apps-script/src/51_citation.js) formatter; no new
  citation styles.
- **No re-anchoring changes.** Marks remain session-only per build plan §2.

## 4. Two-tab layout

The panel header and "Saving to:" subheader are unchanged. Directly below them,
an underline-style tab bar:

```
  Source      Annotations (4)
 ─────────   ───────────────
```

- **Tabs:** `Source` and `Annotations`. The Annotations tab shows a count badge
  (the page's highlight count); Source shows none.
- **Default tab:** Annotations — preserves today's behavior (after highlighting,
  the student lands on their notes).
- **Persistence:** the active tab is held in sidebar state (`state.activeTab`)
  and survives re-renders within the session. Not persisted across page loads.
- Switching tabs never refetches; both tabs render from the same in-memory
  state.

## 5. Source tab

### 5.1 Reachability and empty state

- If no source exists for the page yet (no highlight saved), the Source tab
  shows an empty state: *"Highlight something on this page to start its
  citation."*
- Once a source exists, the tab renders the citation form.

### 5.2 The citation form (mirrors the Docs editor)

Field set and precedence are copied from
[`source_editor_js.html`](../../../apps-script/src/source_editor_js.html)
`renderCitationForm` / `sourceFieldsFor_` so the two surfaces never drift:

- **Source type** dropdown: `website | article | book | primary`.
- **Per-type fields** (identical to `sourceFieldsFor_`):
  - website: Title, Site name, Author, Published date, URL
  - article: Article title, Publication name, Author, Published date, Volume,
    Issue, Pages, URL
  - book: Book title, Author, Publisher, Year
  - primary: Title, Author/creator, Date, Archive/repository, URL
- **Tag** control: Primary / Secondary / Unset (segmented control; the Docs
  editor uses radios — the extension uses a segmented control for touch/density,
  same three values from `PRIMARY_SECONDARY`).
- **Annotation** textarea.
- **Live MLA preview** box.

**Field precedence** (same as the Docs form): student-entered
`citationFields` win, then the rich scrape (`scrapedExtra` + the four discrete
`scraped*` values), then `sourceType` falls back to `website`. The extension
parses the raw `citationFields` / `scrapedExtra` JSON strings client-side (the
`mySources` GET returns them raw, unlike the Docs sidebar's pre-parsed path).

### 5.3 Saving

- Edits autosave on `change`/`blur` (text fields) and debounced (~600 ms) for
  the annotation textarea — same cadence as the Docs editor and the existing
  highlight note field.
- A save enqueues a **full source upsert** built from the current
  `state.pageSource` (carries both the scraped fields and the citation fields),
  not a sparse patch. This avoids `upsertSource_` blanking omitted `scraped*`
  fields (those columns default to `''` when the payload omits them, unlike the
  citation fields which are preserved).
- A "✓ saved" / "saving…" pill reflects sync status, consistent with the
  highlight entries.

### 5.4 Live preview

- A new **`previewCitation` GET endpoint** wraps the existing
  `formatCitation(fields, style)` so the formatter stays the single source of
  truth (no JS fork of MLA logic in the extension). Content scripts cannot call
  the API directly, so the call is proxied through the service worker: a
  `previewCitation` content→background message → `apiGet` → the new GET action.
- The preview call is debounced and fires after edits. Offline or on error,
  the preview shows *"Preview updates when you're back online"* — field edits
  still save via the queue regardless.

## 6. Data plumbing

### 6.1 Reading the source

- `state.pageSource` (new) holds the canonical source object for the page:
  `{ sourceId, projectId, normalizedUrl, rawUrl, scrapedTitle, scrapedSite,
  scrapedDate, scrapedAuthor, scrapedExtra(parsed), citationFields(parsed),
  sourceType, primarySecondary, annotation, accessDate }`.
- [`background.js`](../../../extension/background.js) `loadPageHighlights_`
  already fetches `mySources` and computes the `matching` sources for the page;
  it currently returns only highlights. Extend its return to include the
  canonical matching source row (oldest, matching the existing dedup
  convention). The sidebar populates `state.pageSource` from it, parsing the
  JSON columns.
- **Just-highlighted page (server row not yet synced):** when the first
  highlight is captured, seed `state.pageSource` from the scrape data already
  passed to `getOrCreateSourceId` plus the minted `sourceId`, so the Source tab
  is usable before the upsert drains. The server row, once loaded, reconciles
  by `sourceId`.

### 6.2 Writing the source (new message)

- New content→background message `enqueueSourcePatch` (named for the student's
  intent — "save my citation edits"; the payload is a full source upsert as in
  §5.3, not a sparse patch). Background enqueues a `source` queue item carrying
  scraped + citation fields.
- `upsertSource_` is **unchanged** — its existing field-by-field merge already
  makes an explicitly-provided citation field win and a scrape re-assert (which
  omits those fields) preserve prior values.

### 6.3 Queue coalescing fix

- Today [`background.js`](../../../extension/background.js)
  `enqueueSourceUpsert_` removes any pending `source` queue item for the same
  `sourceId` and enqueues the new one (last-write-wins). A citation edit
  followed by a scrape re-assert (e.g. the student highlights again before the
  queue drains) would drop the not-yet-synced citation edit.
- **Fix:** coalesce by **merging** payloads for the same `sourceId` —
  `Object.assign(existingPayload, newPayload)` with non-empty values winning —
  so a citation edit and a later scrape re-assert combine into one pending
  write instead of clobbering each other. Applies to both the scrape-assert
  path and the new citation-write path.

## 7. Delete flow

- The per-note two-step **Delete → Confirm?** affordance is unchanged.
- On confirming a note deletion, determine whether it was the **last** note
  referencing its `sourceId` (the existing `stillReferenced` check):
  - **Not the last note:** unchanged — enqueue the highlight delete with
    `cascadeSource = false`, no toast. The source stays.
  - **Last note (would orphan the source):** enqueue the highlight delete with
    `cascadeSource = false` (source kept by default — the safe choice now that
    it may hold citation work), then show a **toast** at the bottom of the
    panel:
    > *"Last note removed. Keep this source's citation, or delete the source
    > too?"*  **[Keep]** **[Delete source]**
    - **Keep** (also the auto-dismiss default after ~7 s): do nothing further;
      the source row remains with its citation.
    - **Delete source:** enqueue a source deletion and clear the local
      `pageSource:` cache entry for the URL (so a later highlight mints a fresh
      source rather than reusing a server-deleted id).

### 7.1 Backend: source delete in `doPost`

- [`30_endpoints.js`](../../../apps-script/src/30_endpoints.js) currently
  handles only `d.kind === 'highlight'` in the `deletes` loop. Add a
  `d.kind === 'source'` branch that calls the existing orphan-safe
  `deleteSourceIfOrphaned_(studentSheet, d.id)` (it already refuses to delete a
  source that still has referencing highlights). The "Delete source" toast
  action enqueues `{ kind: 'source', id: sourceId }`.

## 8. Filter — vertical facet list (Annotations tab)

Replace the wrapping `.filter-row` of pills with a compact vertical list:

- A header row **"All notes"** with the total count (active/selected styling).
- One row per bundle category, in bundle order (which is the NHD timeline
  order): a small rounded color swatch · label · right-aligned count.
- Categories with a zero count are **dimmed** (still visible, not removed) —
  they double as a legend and quietly signal "nothing here yet."
- **Single-select**, matching today: clicking a row filters to that category;
  clicking the active row (or "All notes") clears the filter. The existing
  `state.filter` / `filteredHighlights_` / `countByCategory_` logic is reused;
  only the rendering changes.

## 9. Out-of-scope reminders honored

- One source per page; MLA only; no re-anchoring; bundles immutable; dashboard
  counts unaffected (this is sidebar-only).

## 10. Testing

- **GAS (editor-callable):**
  - Extend or add a `devTest` asserting `upsertSource_` round-trips citation
    fields written *without* scraped fields and that a subsequent scrape-only
    re-assert preserves them (the merge already exists; this locks it for the
    new write path). `devTestScrapedExtraRoundTrip` is the nearest existing
    coverage.
  - Add a `devTest` for the new `previewCitation` GET (delegates to
    `formatCitation`, returns `{ text, italics }`).
  - Add a `devTest` for the `kind:'source'` delete branch in `doPost`
    (orphaned source removed; source with remaining highlights refused).
- **DOM-side (no GAS test — real-page QA):** the two-tab UI, the Source form,
  autosave, the live preview, the facet-list filter, and the orphan toast.
  Exercise on a news article, an academic page, and the PDF panel. Verify a
  citation edit survives highlighting again on the same page before the queue
  drains (the §6.3 coalescing fix).

## 11. Files touched

- [`extension/content/sidebar.js`](../../../extension/content/sidebar.js) —
  tab bar, Source tab + form + preview, facet-list filter, orphan toast,
  `state.pageSource` / `state.activeTab`.
- [`extension/background.js`](../../../extension/background.js) —
  `loadPageHighlights_` returns the canonical source; `enqueueSourcePatch`
  handler; `enqueueSourceUpsert_` merge-coalescing; `previewCitation` message
  handler proxying to `apiGet`; source-delete enqueue.
- [`extension/shared/api.js`](../../../extension/shared/api.js) — only if its
  GET helper isn't already generic over `action` (for `previewCitation`).
- [`apps-script/src/30_endpoints.js`](../../../apps-script/src/30_endpoints.js) —
  `previewCitation` action; `kind:'source'` delete branch.
- [`apps-script/src/99_dev.js`](../../../apps-script/src/99_dev.js) — new tests.
- [`apps-script/src/20_writes.js`](../../../apps-script/src/20_writes.js) — no
  change expected (merge already correct); listed for awareness.
