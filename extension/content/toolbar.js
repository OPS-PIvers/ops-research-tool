/**
 * Selection toolbar — the most-repeated action.
 *
 * Flow (build plan §2):
 *   1. User selects text on the page.
 *   2. A floating panel appears near the selection with the 5 category
 *      swatches (colors + labels from the active bundle) and an optional
 *      note affordance.
 *   3. Click a swatch → save the highlight (background.js handles
 *      sourceId allocation + enqueue) and wrap the selected text in a
 *      colored span (marks.js). Toolbar closes.
 *   4. If no active project is set, the toolbar shows a prompt to open
 *      the extension popup instead of swatches.
 */

let toolbarEl = null;
let bundleCache = null;
let projectCache = null;
let noteOpen = false;

document.addEventListener('mouseup', onSelectionMaybeChanged, true);
document.addEventListener('keyup', (e) => {
  // Show on keyboard selection too (shift+arrow). Hide on Escape.
  if (e.key === 'Escape') { hideToolbar(); return; }
  onSelectionMaybeChanged();
}, true);
document.addEventListener('mousedown', (e) => {
  if (toolbarEl && !toolbarEl.contains(e.target)) hideToolbar();
}, true);

async function onSelectionMaybeChanged() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) { hideToolbar(); return; }
  const text = sel.toString();
  if (!text || text.trim().length === 0) { hideToolbar(); return; }
  if (isSelectionInEditable_(sel)) { hideToolbar(); return; }

  // Always re-fetch project/bundle on selection: cheap, and avoids staleness
  // after the student changes the active project in the popup.
  try {
    const ctx = await chrome.runtime.sendMessage({ type: 'getActiveProject' });
    if (ctx && ctx.ok) {
      projectCache = ctx.project;
      bundleCache = ctx.bundle;
    } else {
      console.warn('[OPS] getActiveProject returned:', ctx);
    }
  } catch (e) {
    console.warn('[OPS] getActiveProject failed:', e);
  }

  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return;
  showToolbar(rect, sel, text);
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

function showToolbar(rect, sel, text) {
  if (!toolbarEl) toolbarEl = buildToolbarEl_();
  document.body.appendChild(toolbarEl);
  renderToolbar_();
  // Position just below the selection, scroll-corrected.
  const top = rect.bottom + window.scrollY + 6;
  const left = Math.max(8, rect.left + window.scrollX);
  toolbarEl.style.top = top + 'px';
  toolbarEl.style.left = left + 'px';
  // Stash the selected text + range so the swatch click can use them even
  // if the user releases the selection before clicking.
  toolbarEl.__selectedText = text;
  toolbarEl.__range = sel.getRangeAt(0).cloneRange();
}

function hideToolbar() {
  if (!toolbarEl) return;
  if (toolbarEl.parentNode) toolbarEl.parentNode.removeChild(toolbarEl);
  noteOpen = false;
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

  // Project label
  const pLabel = document.createElement('div');
  pLabel.className = 'ops-research-toolbar-project';
  pLabel.textContent = 'Saving to: ' + projectCache.name;
  toolbarEl.appendChild(pLabel);

  // Swatch row
  const row = document.createElement('div');
  row.className = 'ops-research-toolbar-row';
  for (let i = 1; i <= 5; i++) {
    const label = bundleCache['label' + i];
    const color = bundleCache['color' + i];
    if (!label) continue;
    const sw = document.createElement('button');
    sw.className = 'ops-research-swatch';
    sw.style.backgroundColor = color;
    sw.title = label;
    sw.setAttribute('aria-label', label);
    sw.addEventListener('click', () => saveHighlight_(label, color));
    row.appendChild(sw);
  }
  toolbarEl.appendChild(row);

  // Note toggle + textarea (optional)
  const noteToggle = document.createElement('button');
  noteToggle.className = 'ops-research-toolbar-note-toggle';
  noteToggle.textContent = noteOpen ? 'Hide note' : 'Add note';
  noteToggle.addEventListener('click', () => {
    noteOpen = !noteOpen;
    renderToolbar_();
  });
  toolbarEl.appendChild(noteToggle);

  if (noteOpen) {
    const ta = document.createElement('textarea');
    ta.className = 'ops-research-toolbar-note';
    ta.placeholder = 'optional note…';
    ta.id = 'ops-research-toolbar-note-input';
    toolbarEl.appendChild(ta);
    setTimeout(() => ta.focus(), 0);
  }
}

function saveHighlight_(primaryCategory, color) {
  const text = toolbarEl.__selectedText;
  const range = toolbarEl.__range;
  if (!text || !range) { hideToolbar(); return; }
  const noteInput = toolbarEl.querySelector('#ops-research-toolbar-note-input');
  const note = noteInput ? noteInput.value : '';

  // Optimistic: visual mark + sidebar entry land BEFORE any await. The
  // student sees the highlight appear instantly; the network sync happens
  // in the background and the sidebar's status pill ("saving…" → "saved"
  // → "error") reflects the real state.
  const highlightId = newUuid();
  wrapRangeWithMark(range, color, highlightId);
  if (self.OpsSidebar) {
    self.OpsSidebar.addHighlight({
      highlightId,
      sourceId: null, // filled in once getOrCreateSourceId resolves; the
                     // sidebar's update path uses the same UUID, so the
                     // sourceId is just metadata for editing later
      primaryCategory,
      color,
      text,
      note,
    });
  }
  hideToolbar();

  // Async save — fire and forget; result updates the sidebar status pill.
  syncHighlight_(highlightId, primaryCategory, text, note);
}

async function syncHighlight_(highlightId, primaryCategory, text, note) {
  try {
    const scrape = scrapePageMeta();
    const srcResp = await chrome.runtime.sendMessage({
      type: 'getOrCreateSourceId',
      rawUrl: location.href,
      scrape,
    });
    if (!srcResp || !srcResp.ok) throw new Error((srcResp && srcResp.error) || 'no sourceId');
    // Backfill sourceId into the sidebar entry so the editor's re-enqueue
    // path includes it.
    if (self.OpsSidebar && self.OpsSidebar._setSourceId) {
      self.OpsSidebar._setSourceId(highlightId, srcResp.sourceId);
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
    console.warn('[OPS] save failed:', e);
    if (self.OpsSidebar) self.OpsSidebar.markError(highlightId, e.message || String(e));
  }
}
