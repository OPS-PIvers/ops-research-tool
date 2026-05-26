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

  // Lazy-load bundle + project context the first time we need it.
  if (!bundleCache || !projectCache) {
    const ctx = await chrome.runtime.sendMessage({ type: 'getActiveProject' }).catch(() => null);
    if (ctx && ctx.ok) { projectCache = ctx.project; bundleCache = ctx.bundle; }
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

async function saveHighlight_(primaryCategory, color) {
  const text = toolbarEl.__selectedText;
  const range = toolbarEl.__range;
  if (!text || !range) { hideToolbar(); return; }
  const noteInput = toolbarEl.querySelector('#ops-research-toolbar-note-input');
  const note = noteInput ? noteInput.value : '';

  // Show in-flight status; remove the toolbar UI but don't reset the
  // selection wrapping until we get the sourceId back.
  toolbarEl.innerHTML = '';
  const status = document.createElement('div');
  status.className = 'ops-research-toolbar-status';
  status.textContent = 'Saving…';
  toolbarEl.appendChild(status);

  try {
    const scrape = scrapePageMeta();
    const srcResp = await chrome.runtime.sendMessage({
      type: 'getOrCreateSourceId',
      rawUrl: location.href,
      scrape,
    });
    if (!srcResp || !srcResp.ok) throw new Error((srcResp && srcResp.error) || 'no sourceId');
    const sourceId = srcResp.sourceId;

    const highlightId = newUuid();
    wrapRangeWithMark(range, color, highlightId);

    const hlResp = await chrome.runtime.sendMessage({
      type: 'enqueueHighlight',
      highlight: {
        highlightId,
        sourceId,
        primaryCategory,
        highlightedText: text,
        note,
      },
    });
    if (!hlResp || !hlResp.ok) throw new Error((hlResp && hlResp.error) || 'enqueue failed');
    hideToolbar();
  } catch (e) {
    status.textContent = 'Save failed: ' + (e.message || e);
    status.classList.add('ops-research-toolbar-error');
    setTimeout(hideToolbar, 3000);
  }
}
