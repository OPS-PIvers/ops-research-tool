# Sidebar edit-modal redesign

**Date:** 2026-05-27
**Status:** Approved design — ready for implementation plan
**Scope:** Google Docs sidebar (Phase 3) — replace the global "Pop out" modal
with a per-source editor modal; remove inline editing from the sidebar; add
source deletion.

## 1. Problem

The current sidebar mixes browsing and editing in one cramped surface, and
the "Pop out" affordance is unusable for middle schoolers:

1. **"Pop out" is non-obvious.** A single button at the top-right reopens
   the *entire* sidebar in a wider dialog. Students don't connect "I want
   to edit this source" with "I should click that icon at the top of the
   panel."
2. **Nested scrolling.** The dialog mode uses CSS `column-count: 2`, which
   interacts badly with tall expanded forms — the multi-column layout
   forces horizontal overflow when one card's "Edit citation" form is open,
   producing a layout that requires vertical scrolling to discover hidden
   horizontal scrolling. Documented in the issue: *"No one in their right
   mind would design the modal in a way that required a bit of vertical
   scrolling to discover a TON of horizontal scrolling."*
3. **No way to delete a source.** Sources today are only removed via
   cascade when the last highlight on them is deleted. There is no direct
   "delete this source" action. If a student abandons a source partway
   through, they cannot clean it up — and the cascade does not always fire
   as expected from the user's perspective.

## 2. Goals

- Make "open the editor for this source/evidence" a direct, contextual
  action on each card.
- Single editing surface — one modal per source, never a combined view of
  many sources at once.
- The modal has no horizontal scroll under any condition.
- Direct source deletion with an evidence-count confirmation.
- Preserve current autosave behavior — no new "Save" buttons.
- No changes to citation logic, MLA preview, Insert Bibliography, the
  Chrome extension, or the server storage shape.

## 3. Non-goals

- Adding a per-doc bulk-edit, multi-source selection, or drag-and-drop
  reordering.
- Adding new citation styles (Chicago/APA stay deferred per build plan).
- Replacing the autosave UX with explicit Save/Cancel buttons.
- Adding a confirmation step for routine highlight edits.
- Adding a real-time multiplayer indicator (two-window editing is a rare
  edge case; we handle it defensively but do not surface presence).
- Adding any unit-test framework on the sidebar/modal client. Server
  remains the test surface.

## 4. Architecture

Two GAS HTML templates, two JS files, one shared CSS file:

```
apps-script/src/
  sidebar.html              ← browse view only (current template, simplified)
  sidebar_js.html           ← list/filter/dispatch only; no edit forms
  source_editor.html        ← NEW — modal template, parameterised by sourceId
  source_editor_js.html     ← NEW — citation form + evidence editor + delete
  sidebar_css.html          ← shared design tokens + selectors; both templates include it
```

The current "one template, two `mode`s" pattern is the root cause of the
CSS multi-column hack. Two focused templates produce two smaller,
single-purpose files. Some CSS duplicates between them; shared rules live
in `sidebar_css.html`.

The modal opens via the standard GAS pattern used today by
`sidebarOpenAsDialog` — `DocumentApp.getUi().showModalDialog(...)` — but
scoped to a single source via template binding.

**Sidebar ↔ modal sync.** GAS modal dialogs run in isolated iframes; no
direct postMessage is possible. Pattern: the modal autosaves on each
field change (same UX as today's inline forms). The sidebar, while it
believes a modal is open, polls `sidebarGetProjectData` every 3 seconds.
Each tick the sidebar JSON-stringifies the response and diffs against the
last; if changed, it re-renders. The polling flag clears either when the
source the modal opened on disappears from the response (delete case) or
after a bounded number of unchanged ticks (user closed the modal without
edits).

## 5. Sidebar changes (browse-only view)

### Removed

- Global `⇱ Pop out` button in `sidebar.html` header.
- Per-source `Edit citation` / `Hide citation` button.
- Per-source inline citation form (`renderSourceForm` and the
  `expandedSourceId` state field).
- Per-highlight `Edit` / `Done` button.
- Per-highlight `Delete` / `Cancel` / `Confirm delete` row.
- Per-highlight inline editor (`renderHighlightEditor` and the
  `editingHighlightId`, `confirmingDeleteId` state fields).
- Dialog-mode CSS — `.sb-body--dialog .sb-main { column-count: 2; ... }`
  and friends.
- `mode` template variable; `window.OPS_MODE` global; `body` class
  variant `sb-body--<mode>`.

### Added / changed

- Each source card grows one primary action: **"Open in editor"**. Slot
  it where "Edit citation" used to live, with the same `.sb-source__action`
  styling.
- Each highlight row grows one action: **"Open in editor"**. Slot it where
  the old "Edit" button lived.
- `Insert in-text` button on the source card is unchanged — non-editing,
  useful from browse view.
- Source cards keep: title, URL, primary/secondary chip, breakdown dots
  (source mode), highlight count, expand/collapse caret (source mode).
- Highlight rows keep: color bar, primary/secondary category labels,
  highlighted text (still truncated to 240 chars in the sidebar — full
  text shows in the modal), note (read-only).
- Project picker, view-mode pills, filter chips strip, Insert Bibliography
  footer — all unchanged.

### State shape after simplification

```js
const state = {
  ctx, projectId, sources, highlights,
  filterCat, filterPS, viewMode,
  expandedSourceIds,   // source-mode collapse/expand only
  sourceFilters,       // per-source category filter (source mode only)
  modalOpenForSourceId: null,   // NEW — drives the 3s polling loop
  lastDataJson: null,           // NEW — diff cache for the polling loop
};
```

Removed: `expandedSourceId`, `editingHighlightId`, `confirmingDeleteId`.

## 6. The per-source modal

### Opening

Trigger: any "Open in editor" button →
`google.script.run.sidebarOpenSourceEditor(projectId, sourceId, focusHighlightId?)`.

`focusHighlightId` is set when the modal is opened from a highlight card;
omitted when opened from the source card.

Server opens the dialog at 820×720 with a template binding:

```html
<script>
  window.OPS_EDITOR_CTX = {
    projectId: '<?= projectId ?>',
    sourceId: '<?= sourceId ?>',
    focusHighlightId: '<?= focusHighlightId ?>' || null
  };
</script>
```

The sidebar, immediately after the `google.script.run` call to open the
modal, sets `state.modalOpenForSourceId = sourceId` and begins polling.

### Layout

Two-pane horizontal split inside the modal body. Sticky header at the
top. No horizontal scroll under any condition.

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Back to sidebar     [source title — truncated]              ✕    │
├──────────────────────────────────┬──────────────────────────────────┤
│ Citation                          │ Evidence (N)                    │
│                                   │ [filter chips: All · 🟢 · 🔵 ]  │
│ Source type: [website ▾]          │                                  │
│ Title:        [_____________]     │ ┌──────────────────────────┐    │
│ Site name:    [_____________]     │ │ ▌Argument                │    │
│ Author:       [_____________]     │ │  "The first amendment…"  │    │
│ Published:    [_____________]     │ │  Note: italic, gray      │    │
│ URL:          [_____________]     │ │  [Edit] [Delete]         │    │
│ Classification: ○ p ● s ○ unset   │ └──────────────────────────┘    │
│ Annotation:                       │ ┌──────────────────────────┐    │
│ ┌─────────────────────────┐       │ │ ▌Counter-argument        │    │
│ │                         │       │ │  …                       │    │
│ └─────────────────────────┘       │ └──────────────────────────┘    │
│ MLA preview:                      │  …more evidence…                 │
│ ┌─────────────────────────┐       │                                  │
│ │ Smith, John. "Title."…  │       │                                  │
│ └─────────────────────────┘       │                                  │
│                                   │                                  │
│ [🗑 Delete source]                │                                  │
└──────────────────────────────────┴──────────────────────────────────┘
```

CSS structure:

- `body` has `overflow-x: hidden`.
- `.sb-modal` is a flex column: header (auto), body (flex 1).
- `.sb-modal__body` is `display: flex; gap: 12px; min-height: 0;`.
- Left pane: `flex: 0 0 46%; overflow-y: auto; min-width: 0;`.
- Right pane: `flex: 1; overflow-y: auto; min-width: 0;`.
- `min-width: 0` on both panes is the critical fix that prevents flex
  children from forcing horizontal overflow.

### Left pane — citation editor

- Identical field set per source type as today
  (`website`, `article`, `book`, `primary`). Field definitions stay in
  `sourceFieldsFor_`, which moves verbatim into `source_editor_js.html`.
- Same debounced save-on-blur pattern as today's inline form. Save calls
  the existing `sidebarUpdateSource` endpoint — no new server function.
- MLA preview rendered via the existing `sidebarPreviewCitation` endpoint —
  no changes server-side.
- Primary/secondary radio group identical to today.
- Annotation textarea identical to today.
- "Delete source" button anchored at the bottom of the left pane scroll
  region (i.e., the user scrolls past the preview to reach it). Styled
  with the `.sb-danger` modifier — red background, white text, trash icon.

### Right pane — evidence editor

- Per-source category filter chips at the top, identical to today's
  source-mode filter row.
- Each evidence card shows the full highlighted text (no 240-char
  truncation — there is room here).
- Card actions: **Edit** (expands the existing mini-editor with primary
  swatches, secondary swatches, note textarea) and **Delete**
  (two-step confirm: Delete → Cancel | Confirm delete).
- Mini-editor is the same `renderHighlightEditor` body that exists today,
  moved verbatim into `source_editor_js.html`.
- Per-highlight delete uses the existing `sidebarDeleteHighlight`
  endpoint with `cascadeSource = false` — even if it's the last highlight
  on the source, the source is NOT cascade-deleted from the modal. The
  modal shows a banner: *"This was the last piece of evidence. The source
  still exists — close the editor or click 'Delete source' below."*

### Focus behavior

If `focusHighlightId` is set on load:

1. After the initial render, `document.getElementById('hl-' + focusHighlightId)`
   is scrolled into view inside the right pane.
2. Its Edit button is programmatically clicked to expand the mini-editor.

If the highlight is not present (e.g., it was deleted between sidebar
render and modal open), the modal silently ignores the focus param — no
error, just opens normally.

### Delete source flow

1. Initial state: single `🗑 Delete source` button at bottom-left.
2. First click: button row morphs into two buttons —
   `[Cancel] [Confirm — delete source and N pieces of evidence]`. If
   N = 0, label is `Confirm — delete source`.
3. Cancel reverts. Confirm calls `sidebarDeleteSource(projectId, sourceId)`.
4. On success: modal calls `google.script.host.close()`. The sidebar's
   next poll tick observes that the sourceId is gone and re-renders.
5. On failure: modal stays open, status line shows the error in red, the
   button row reverts to the initial single-button state (user can retry).

Unlike the highlight delete (which is optimistic + reversible), the source
delete is NOT optimistic. Rolling back a closed modal is worse UX than
letting the user see the error and retry.

### Modal state shape

```js
const editor = {
  projectId, sourceId, focusHighlightId,    // from OPS_EDITOR_CTX
  source: null, highlights: [],             // loaded from sidebarGetProjectData
  bundle: null,                             // loaded from sidebarGetContext
  perSourceFilter: null,                    // category label or null
  editingHighlightId: null,
  confirmingHighlightDeleteId: null,
  confirmingSourceDelete: false,
};
```

## 7. Server API changes

### New endpoint: `sidebarOpenSourceEditor(projectId, sourceId, focusHighlightId)`

- File: `53_sidebar_api.js`.
- Auth: `getActorEmail_()` (same pattern as siblings).
- Validates that `projectId` and `sourceId` resolve to a row owned by the
  caller. If not, throws — the sidebar's `withFailureHandler` surfaces
  the error.
- Calls `DocumentApp.getUi().showModalDialog(...)` with the new
  `source_editor` template, passing `projectId`, `sourceId`, and
  `focusHighlightId` via template binding.
- Returns `{ ok: true }`.

### New endpoint: `sidebarDeleteSource(projectId, sourceId)`

- File: `53_sidebar_api.js`.
- Auth: `getActorEmail_()`.
- Resolves the per-(student, project) sheet via
  `findOrCreateStudentSheet_`.
- In `Highlights` tab: read all rows, filter out those matching
  `sourceId`, write the kept rows back in one operation.
- In `Sources` tab: read all rows, filter out the one matching
  `sourceId`, write the kept rows back in one operation.
- Both writes happen in the same script execution. If the script times
  out between the two writes, the next-load state is: highlights gone,
  source present. This is acceptable — a retry of `sidebarDeleteSource`
  is idempotent on the highlights and completes the source delete.
- Returns `{ ok: true, deletedHighlights: N, deletedSource: true }`.

### Deleted endpoint: `sidebarOpenAsDialog`

Remove from `53_sidebar_api.js`. The HTML reference in `sidebar.html`
and the click handler in `sidebar_js.html` are both removed in the same
patch.

### Unchanged endpoints (reused by the modal)

- `sidebarGetContext` — modal calls this to get the active bundle for
  evidence color swatches.
- `sidebarGetProjectData` — modal calls this once at load (filters
  client-side to the single source); sidebar calls this on a 3s poll
  loop while a modal is open.
- `sidebarUpdateSource` — citation field saves.
- `sidebarUpdateHighlight` — highlight category/note saves.
- `sidebarDeleteHighlight` — per-highlight delete from the modal's
  right pane, always called with `cascadeSource = false`.
- `sidebarPreviewCitation` — MLA live preview in the modal's left pane.
- `sidebarInsertInlineCitation` — unchanged, still called from the
  sidebar's source cards (`Insert in-text` button).
- `sidebarInsertBibliography` — unchanged, still called from the sidebar
  footer.

## 8. Polling protocol

The sidebar polls `sidebarGetProjectData` every 3000 ms whenever
`state.modalOpenForSourceId !== null`. Each tick:

1. Call `sidebarGetProjectData(projectId)`.
2. JSON-stringify the response. If equal to `state.lastDataJson`, no-op.
3. If different, update `state.sources`, `state.highlights`,
   `state.lastDataJson`, then `render()`.
4. If `state.sources` no longer contains a row with
   `sourceId === state.modalOpenForSourceId`, the modal closed via a
   source delete. Clear `state.modalOpenForSourceId`, stop polling.
5. Bounded fallback stop: after 200 consecutive unchanged ticks (~10
   minutes), clear `state.modalOpenForSourceId` defensively. The user
   left the modal open with no edits; we stop polling to be polite to
   the quota. Reopening the modal would resume polling.

Failure handling: a polling call that errors is swallowed silently
(`withFailureHandler` is a no-op). Transient errors should not surface
to a user who isn't doing anything wrong.

The modal does not poll. The modal autosaves; the sidebar observes.

## 9. Two-window edge case

If a student has two Docs open with the modal targeting the same source
in one and the sidebar (or even another modal) in the other:

- Each window has its own iframe + state. Saves from window A are
  visible in window B's sidebar on the next 3s poll.
- If both windows edit the same field, the last write wins at the
  sheet-row level (current `upsertByKey_` semantics — unchanged).
- If window A deletes the source while window B has the modal open on
  it, window B's next poll will not find the source. We do not surface
  this — but the modal already handles "source missing from response"
  with the empty-state described in §10.

This is intentionally minimal handling. Phase 3 is single-student,
single-doc in practice; cross-window editing is not a supported workflow.

## 10. Error handling

- Field-save failures (`sidebarUpdateSource`/`sidebarUpdateHighlight`):
  status line shows red error message via the existing `setStatus`
  helper. Form values stay in the inputs (no rollback of typed text).
- Highlight delete failure: existing rollback behavior preserved
  (`optimisticallyDeleteHighlight_` snapshot/restore pattern). Moves
  verbatim into the modal.
- Source delete failure: non-optimistic. Modal stays open, status line
  shows error, delete button reverts to initial state.
- Modal load fails (`sidebarGetProjectData` throws): modal renders an
  empty state with a single Close button: *"Could not load this source.
  Close this window and try again."*
- Modal opened on a sourceId that no longer exists: same empty state.
- Sidebar polling failure: silently ignored, next tick retries.
- All `withFailureHandler` callers stringify `e && e.message || e` —
  same defensive pattern used today.

## 11. Testing

### Server-side (editor-callable, per the GAS-V8 convention)

- **NEW** `devTestDeleteSource` in `99_dev.js`:
  1. Seed a project with the Dev seeding helper.
  2. Insert a source via `upsertSource_`.
  3. Insert 3 highlights on that source via `upsertHighlight_`.
  4. Insert 1 highlight on a *different* source as a control.
  5. Call `sidebarDeleteSource(projectId, sourceId)`.
  6. Assert response: `deletedHighlights === 3`, `deletedSource === true`.
  7. Assert `Highlights` tab: zero rows with the target sourceId, the
     control highlight still present.
  8. Assert `Sources` tab: target source row gone, other sources
     untouched.
  9. Idempotency: call `sidebarDeleteSource` again on the same sourceId.
     Should return `{ ok: true, deletedHighlights: 0, deletedSource: false }`
     (or equivalent) — must not throw.

- Existing tests stay green: `devTestRoundTrip`, `devTestNormalizeUrl`,
  `devTestSourceDedup`.

### Client-side (manual QA matrix, documented but not automated)

The sidebar/modal client has no test harness today; adding one is out of
scope. The implementation plan will include a manual checklist:

- Open editor from source card.
- Open editor from highlight card → focus highlight is scrolled into
  view, editor pre-expanded.
- Open editor on a source whose only highlight was just deleted in
  another window → empty-state renders cleanly.
- Edit citation field → save indicator → close modal → reopen → value
  persisted.
- Edit highlight category swatch → save indicator → close modal →
  reopen → category persisted.
- Delete highlight (mid-list) → row vanishes, others remain.
- Delete highlight (only one on source) → row vanishes, banner appears.
- Delete source with 0 highlights.
- Delete source with N highlights → button label shows N, second click
  closes modal, sidebar list refreshes.
- Modal open, no edits, wait 30 seconds → sidebar still responsive,
  network calls every 3s.
- Modal open, edit, close → sidebar reflects change within 3s.
- Network drop mid-save → red status, no data loss in inputs.
- Insert Bibliography still produces correct MLA output for all four
  source types.

## 12. Files touched

| File | Change |
|------|--------|
| `apps-script/src/sidebar.html` | Remove `⇱ Pop out` button, `mode` template var, `OPS_MODE` script |
| `apps-script/src/sidebar_js.html` | Remove inline edit/delete code; add modal-open dispatch + 3s poll loop; shrink state |
| `apps-script/src/sidebar_css.html` | Remove `.sb-body--dialog` rules; extract shared tokens for the modal to reuse |
| `apps-script/src/source_editor.html` | **NEW** — modal template |
| `apps-script/src/source_editor_js.html` | **NEW** — modal JS (citation form, evidence editor, delete) |
| `apps-script/src/50_docs_addon.js` | No change (the new `sidebarOpenSourceEditor` lives in 53) |
| `apps-script/src/53_sidebar_api.js` | Add `sidebarOpenSourceEditor`, `sidebarDeleteSource`; remove `sidebarOpenAsDialog` |
| `apps-script/src/99_dev.js` | Add `devTestDeleteSource` |

No Chrome extension changes. No `02_constants.js` / `20_writes.js` /
`21_reads.js` changes — `sidebarDeleteSource` uses the existing
sheet-helper primitives.

## 13. Out-of-scope reminders

Per `CLAUDE.md` §10, this design holds the following lines:

- v1 MLA only; no Chicago/APA.
- 4 source types only.
- No "insert as quote" button.
- No re-anchoring of highlights.
- No OCR.
- Bundles immutable.
- Teacher dashboard counts primary category only.

This redesign does not touch any of those areas.
