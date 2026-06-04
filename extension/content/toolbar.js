/**
 * Selection toolbar — the most-repeated action.
 *
 * Persistent-draft UX (replaces the original "click-swatch-and-commit"):
 *   1. Selecting text opens the toolbar.
 *   2. Clicking a swatch toggles that category as the *draft* — visible
 *      outline on the chosen swatch — but does NOT save yet.
 *   3. "Add note" expands a textarea. The user can type freely; the toolbar
 *      stays open through every keystroke.
 *   4. The toolbar commits and closes on:
 *        - click outside the toolbar
 *        - Enter (without Shift) inside the note textarea
 *   5. Esc discards the draft and closes without saving.
 *   6. If only a note (no category) was drafted, the highlight saves with an
 *      empty primary category — they can categorize it later in the sidebar.
 *
 * Build plan §2 originally required a primary category at capture time
 * ("the act of choosing is the learning"). Paul relaxed that 2026-05-26 so
 * a useful note doesn't block on a category decision.
 */

const UNCATEGORIZED_COLOR = '#fff8c4'; // pale sticky-note yellow

let toolbarEl = null;
let bundleCache = null;
let projectCache = null;
let noteOpen = false;

// Draft state — accumulates between toolbar open and commit/discard.
let draftSnapshot = null;   // { text, range } captured when the toolbar opened
let draftCategory = null;   // currently chosen primary category label or null
let draftColor = null;
let draftNote = '';

// Borrow the sidebar's already-resolved project/bundle when our own context
// read came back empty (cold start). Only fills gaps — never overwrites a
// project we already have.
function adoptSidebarContext_() {
  if (projectCache && bundleCache) return;
  if (!self.OpsSidebar || !self.OpsSidebar.getContext) return;
  const sc = self.OpsSidebar.getContext();
  if (sc && sc.project) {
    projectCache = projectCache || sc.project;
    bundleCache = bundleCache || sc.bundle;
  }
}

function eventInOurUI_(e) {
  if (!e || !e.target) return false;
  if (toolbarEl && toolbarEl.contains(e.target)) return true;
  // Sidebar lives in a shadow root; its host element is the retargeted
  // target for any event that originated inside the shadow tree.
  const sidebarHost = document.getElementById('__ops_research_sidebar_host');
  if (sidebarHost && sidebarHost.contains(e.target)) return true;
  return false;
}

document.addEventListener('mouseup', (e) => {
  if (eventInOurUI_(e)) return;
  onSelectionMaybeChanged();
}, true);

document.addEventListener('keydown', (e) => {
  // Enter (no Shift) inside the toolbar's note textarea = commit.
  if (e.key === 'Enter' && !e.shiftKey && toolbarEl && toolbarEl.contains(e.target)) {
    if (e.target.tagName === 'TEXTAREA') {
      e.preventDefault();
      commitDraft_();
    }
  }
}, true);

document.addEventListener('keyup', (e) => {
  if (e.key === 'Escape') { discardDraft_(); return; }
  if (eventInOurUI_(e)) return;
  onSelectionMaybeChanged();
}, true);

document.addEventListener('mousedown', (e) => {
  // Click outside the toolbar = commit any in-flight draft, then hide.
  if (toolbarEl && !toolbarEl.contains(e.target)) commitDraft_();
}, true);

async function onSelectionMaybeChanged() {
  // Global off-switch (popup toggle). Cached + synchronous so we don't await
  // before snapshotting the selection. Absent in the PDF panel = never gated.
  if (self.OpsEnabled && !self.OpsEnabled.get()) { hideToolbar(); return; }
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) {
    // Selection went away — if we have a draft, leave it open (user might
    // still want to commit via outside click). If no draft yet, close.
    if (toolbarEl && !draftCategory && !draftNote.trim()) hideToolbar();
    return;
  }
  const text = sel.toString();
  if (!text || text.trim().length === 0) return;
  if (isSelectionInEditable_(sel)) { hideToolbar(); return; }
  if (sel.rangeCount === 0) return;
  // Snapshot range + rect BEFORE any await. The user's selection may
  // collapse during the async getActiveProject roundtrip (e.g. a parent
  // page script fires a click handler that clears selection), and a later
  // sel.getRangeAt(0) would throw IndexSizeError.
  const capturedRange = sel.getRangeAt(0).cloneRange();
  const rect = capturedRange.getBoundingClientRect();
  if (!rect.width && !rect.height) return;

  try {
    const ctx = await chrome.runtime.sendMessage({ type: 'getActiveProject' });
    // Only adopt a result that actually carries a project. A transient null
    // (cold service worker, failed/empty background refresh) must NOT blank a
    // previously-good projectCache — that null is exactly what used to flash
    // "No active project" in the toolbar while the sidebar still showed the
    // project. Fall back to the sidebar's already-resolved context when ours is
    // empty, so the two surfaces can never disagree.
    if (ctx && ctx.ok && ctx.project) {
      projectCache = ctx.project;
      bundleCache = ctx.bundle;
    } else {
      console.warn('[OPS] getActiveProject returned no project:', ctx);
      adoptSidebarContext_();
    }
  } catch (e) {
    // Orphaned tab after a reload/auto-update: the message rejects. Still try the
    // sidebar's cached context (pure JS, survives), and surface the reload hint.
    adoptSidebarContext_();
    if (opsIsContextInvalidated_(e)) {
      if (self.OpsSidebar && self.OpsSidebar.showReloadHint) self.OpsSidebar.showReloadHint();
    } else {
      console.warn('[OPS] getActiveProject failed:', e);
    }
  }

  showToolbar(rect, capturedRange, text);
}

function isSelectionInEditable_(sel) {
  const node = sel.anchorNode;
  if (!node) return false;
  let el = node.nodeType === 1 ? node : node.parentElement;
  while (el && el !== document.documentElement) {
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
    if (el.isContentEditable) return true;
    el = el.parentElement;
  }
  return false;
}

function showToolbar(rect, range, text) {
  if (!toolbarEl) toolbarEl = buildToolbarEl_();
  document.body.appendChild(toolbarEl);

  // If we're freshly opening (no in-flight draft), reset state. If a draft
  // already exists and the user just extended/changed their selection, keep
  // their category/note choices but point at the new range.
  if (!draftSnapshot) {
    draftCategory = null;
    draftColor = null;
    draftNote = '';
    noteOpen = false;
  }
  draftSnapshot = { text, range };
  renderToolbar_();

  const top = rect.bottom + window.scrollY + 6;
  const left = Math.max(8, rect.left + window.scrollX);
  toolbarEl.style.top = top + 'px';
  toolbarEl.style.left = left + 'px';
}

function hideToolbar() {
  if (!toolbarEl) return;
  if (toolbarEl.parentNode) toolbarEl.parentNode.removeChild(toolbarEl);
  draftSnapshot = null;
  draftCategory = null;
  draftColor = null;
  draftNote = '';
  noteOpen = false;
}

function discardDraft_() {
  hideToolbar();
}

function commitDraft_() {
  const snapshot = draftSnapshot;
  const category = draftCategory;
  const note = (draftNote || '').trim();
  if (!snapshot || (!category && !note)) {
    hideToolbar();
    return;
  }
  const color = draftColor || UNCATEGORIZED_COLOR;
  const highlightId = newUuid();
  // Optimistic: wrap + sidebar entry land before any await.
  wrapRangeWithMark(snapshot.range, color, highlightId);
  if (self.OpsSidebar) {
    self.OpsSidebar.addHighlight({
      highlightId,
      sourceId: null,
      primaryCategory: category || '',
      color,
      text: snapshot.text,
      note,
    });
  }
  hideToolbar();
  syncHighlight_(highlightId, category || '', snapshot.text, note);
}

function buildToolbarEl_() {
  const root = document.createElement('div');
  root.className = 'ops-research-toolbar';
  return root;
}

function renderToolbar_() {
  toolbarEl.innerHTML = '';
  if (!projectCache || !bundleCache) {
    const msg = document.createElement('div');
    msg.className = 'ops-research-toolbar-status ops-research-toolbar-error';
    msg.textContent = projectCache
      ? 'Bundle missing — open the extension popup.'
      : 'No active project — pick one from the extension toolbar.';
    toolbarEl.appendChild(msg);
    return;
  }

  const pLabel = document.createElement('div');
  pLabel.className = 'ops-research-toolbar-project';
  pLabel.textContent = 'Saving to: ' + projectCache.name;
  toolbarEl.appendChild(pLabel);

  const row = document.createElement('div');
  row.className = 'ops-research-toolbar-row';
  for (let i = 1; i <= 5; i++) {
    const label = bundleCache['label' + i];
    const color = bundleCache['color' + i];
    if (!label) continue;
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'ops-research-swatch';
    if (draftCategory === label) sw.classList.add('ops-research-swatch--selected');
    sw.style.backgroundColor = color;
    sw.title = label;
    sw.setAttribute('aria-label', label);
    sw.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (draftCategory === label) {
        draftCategory = null;
        draftColor = null;
      } else {
        draftCategory = label;
        draftColor = color;
      }
      renderToolbar_();
    });
    row.appendChild(sw);
  }
  toolbarEl.appendChild(row);

  if (draftCategory) {
    const selDiv = document.createElement('div');
    selDiv.className = 'ops-research-toolbar-selected';
    selDiv.textContent = '✓ ' + draftCategory;
    toolbarEl.appendChild(selDiv);
  }

  const noteToggle = document.createElement('button');
  noteToggle.className = 'ops-research-toolbar-note-toggle';
  noteToggle.type = 'button';
  noteToggle.textContent = noteOpen ? 'Hide note' : (draftNote.trim() ? 'Edit note' : 'Add note');
  noteToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    noteOpen = !noteOpen;
    renderToolbar_();
  });
  toolbarEl.appendChild(noteToggle);

  if (noteOpen) {
    const ta = document.createElement('textarea');
    ta.className = 'ops-research-toolbar-note';
    ta.placeholder = 'optional note…';
    ta.value = draftNote;
    ta.addEventListener('input', () => { draftNote = ta.value; });
    toolbarEl.appendChild(ta);
    // Restore focus + caret across re-renders so swatch clicks don't
    // interrupt typing flow.
    setTimeout(() => {
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }, 0);
  }

  const hasDraft = !!draftCategory || !!draftNote.trim();
  const hint = document.createElement('div');
  hint.className = 'ops-research-toolbar-hint';
  hint.textContent = hasDraft
    ? 'Click outside or press Enter to save · Esc to cancel'
    : 'Pick a color or add a note';
  toolbarEl.appendChild(hint);
}

// Toggled off mid-page: tear down any in-flight toolbar so a stale draft
// doesn't linger after the student silences the extension.
if (self.OpsEnabled) self.OpsEnabled.onChange((on) => { if (!on) hideToolbar(); });

// Warm the project/bundle cache as soon as the content script loads, so the
// FIRST selection already has its save target instead of racing a cold service
// worker and rendering "No active project". The sidebar's own load kicks the
// same (now single-flighted) refresh, so this rides along for free.
chrome.runtime.sendMessage({ type: 'getActiveProject' })
  .then((ctx) => {
    if (ctx && ctx.ok && ctx.project) { projectCache = ctx.project; bundleCache = ctx.bundle; }
  })
  .catch(() => {});

async function syncHighlight_(highlightId, primaryCategory, text, note) {
  try {
    const scrape = scrapePageMeta();
    const srcResp = await chrome.runtime.sendMessage({
      type: 'getOrCreateSourceId',
      rawUrl: opsPageUrl(),
      scrape,
    });
    if (!srcResp || !srcResp.ok) throw new Error((srcResp && srcResp.error) || 'no sourceId');
    if (self.OpsSidebar && self.OpsSidebar._setSourceId) {
      // Pass the scrape so the sidebar's Source tab can seed its citation form
      // from page metadata before the source row syncs back from the server.
      self.OpsSidebar._setSourceId(highlightId, srcResp.sourceId, scrape);
    }
    const hlResp = await chrome.runtime.sendMessage({
      type: 'enqueueHighlight',
      highlight: {
        highlightId,
        sourceId: srcResp.sourceId,
        primaryCategory,
        highlightedText: text,
        note,
      },
    });
    if (!hlResp || !hlResp.ok) throw new Error((hlResp && hlResp.error) || 'enqueue failed');
    if (self.OpsSidebar) self.OpsSidebar.markSynced(highlightId);
  } catch (e) {
    if (self.OpsSidebar) self.OpsSidebar.markError(highlightId, e.message || String(e));
    if (opsIsContextInvalidated_(e)) {
      if (self.OpsSidebar && self.OpsSidebar.showReloadHint) self.OpsSidebar.showReloadHint();
    } else {
      console.warn('[OPS] save failed:', e);
    }
  }
}
