/**
 * In-page sidebar — shadow-DOM-isolated panel for the current page's
 * highlights. Independent of the future Google Docs sidebar (Phase 3),
 * which lives inside a Google Doc and uses GAS HTML Service.
 *
 * Build plan §2 says the page marks vanish on reload and "highlights are
 * never re-rendered on a return visit." This sidebar reflects the same
 * invariant — it shows THIS session's highlights, not historical ones for
 * the URL.
 *
 * Public API used by toolbar.js + marks.js:
 *   OpsSidebar.addHighlight({highlightId, sourceId, primaryCategory, color, text, note, secondaryCategory?})
 *   OpsSidebar.markSynced(highlightId)
 *   OpsSidebar.markError(highlightId, msg)
 *   OpsSidebar.focus(highlightId)   // open + scroll + flash entry
 *   OpsSidebar.show() / hide() / toggle()
 */

const SIDEBAR_CSS = `
:host, .root { all: initial; }
.root {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  color: #202124;
  display: block;
}
.root *, .root *::before, .root *::after { box-sizing: border-box; }
.root button { font: inherit; cursor: pointer; }

.launcher {
  position: fixed; top: 50%; right: 0; transform: translateY(-50%);
  background: #1a73e8; color: #fff; border: none;
  border-radius: 8px 0 0 8px; padding: 10px 8px;
  font-weight: 600; font-size: 12px; letter-spacing: 0.04em;
  box-shadow: -2px 2px 8px rgba(0,0,0,0.18);
  display: flex; flex-direction: column; align-items: center; gap: 4px;
}
.launcher__count {
  background: rgba(255,255,255,0.25); border-radius: 999px;
  padding: 2px 8px; font-size: 11px;
}

.panel {
  position: fixed; top: 0; right: 0;
  width: 360px; height: 100vh; max-height: 100vh;
  background: #fff; border-left: 1px solid #dadce0;
  box-shadow: -4px 0 16px rgba(0,0,0,0.08);
  display: flex; flex-direction: column;
}
.panel__header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; border-bottom: 1px solid #dadce0;
}
.panel__title { font-weight: 600; font-size: 14px; }
.panel__close {
  background: none; border: none; color: #5f6368;
  font-size: 18px; line-height: 1; padding: 4px 8px; border-radius: 4px;
}
.panel__close:hover { background: #f1f3f4; }
.panel__sub {
  padding: 8px 14px; border-bottom: 1px solid #dadce0;
  font-size: 11px; color: #5f6368;
}

.filter-row {
  display: flex; gap: 4px; padding: 8px 12px;
  border-bottom: 1px solid #dadce0; flex-wrap: wrap;
}
.filter-chip {
  display: inline-flex; align-items: center; gap: 6px;
  background: #f1f3f4; border: 1px solid transparent;
  border-radius: 999px; padding: 4px 10px 4px 6px;
  font-size: 11px; color: #5f6368; white-space: nowrap;
}
.filter-chip:hover { border-color: #dadce0; }
.filter-chip--active {
  background: #fff; border-color: #1a73e8; color: #1a73e8; font-weight: 500;
}
.filter-chip__dot { width: 10px; height: 10px; border-radius: 50%; }
.filter-chip__count {
  background: rgba(0,0,0,0.05); border-radius: 999px; padding: 0 6px; font-size: 10px;
}

.list { flex: 1; overflow-y: auto; padding: 8px 0; min-height: 0; }
.list__empty {
  padding: 24px 14px; text-align: center;
  color: #5f6368; font-size: 12px; line-height: 1.5;
}

.entry {
  position: relative; margin: 6px 12px; padding: 10px 12px 10px 16px;
  background: #fff; border: 1px solid #dadce0; border-radius: 6px;
  transition: background 0.8s;
}
.entry__color-bar {
  position: absolute; top: 8px; bottom: 8px; left: 4px;
  width: 4px; border-radius: 2px;
}
.entry__cat {
  font-size: 11px; color: #5f6368; margin-bottom: 4px;
  display: flex; gap: 4px; align-items: center;
}
.entry__secondary {
  font-size: 10px; background: #f1f3f4; padding: 1px 6px; border-radius: 3px;
}

/* Same shape language as .filter-chip — gray pill with a colored dot
   indicating the current secondary tag. */
.entry__alt-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #f1f3f4;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 4px 10px 4px 6px;
  font-size: 11px;
  color: #5f6368;
  white-space: nowrap;
  line-height: 1.4;
}
.entry__alt-pill:hover { border-color: #dadce0; }
.entry__alt-pill--set {
  background: #fff;
  border-color: #1a73e8;
  color: #1a73e8;
  font-weight: 500;
}
.entry__alt-pill__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: transparent;
  border: 1px dashed #5f6368;
}
.entry__alt-pill__dot--set {
  border: none;
}

.entry__alt-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
  padding: 6px 4px 2px;
  border-top: 1px dashed #dadce0;
}
.entry__alt-pick-btn {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid transparent;
  padding: 0;
  background-clip: padding-box;
}
.entry__alt-pick-btn--active { border-color: #202124; }
.entry__alt-pick-btn--none {
  font-size: 10px;
  color: #5f6368;
  background: #fff;
  border: 2px dashed #5f6368;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
.entry__text {
  font-size: 12px; line-height: 1.45; margin-bottom: 6px; cursor: pointer;
}
.entry__text:hover { background: #f8f9fa; border-radius: 3px; }
.entry__note {
  font-size: 11px; font-style: italic; color: #5f6368; margin-bottom: 6px;
}
.entry__actions {
  display: flex; justify-content: space-between; gap: 6px; align-items: center;
}
.entry__actions-right {
  display: flex; gap: 8px; align-items: center;
}
.entry__sync { font-size: 10px; color: #5f6368; }
.entry__sync--pending { color: #b06000; }
.entry__sync--saved   { color: #0f9d58; }
.entry__sync--error   { color: #d93025; }

.entry__warn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #b06000;
  background: #fff4e5;
  padding: 1px 6px;
  border-radius: 4px;
  margin-left: 6px;
  cursor: help;
}
.entry__edit-toggle {
  background: none; border: none; color: #1a73e8;
  font-size: 11px; padding: 2px 6px;
}
.entry--flash { animation: opsFlash 1.2s ease-out; }
@keyframes opsFlash { 0% { background: #fff4a3; } 100% { background: #fff; } }

.editor {
  margin-top: 8px; padding-top: 8px;
  border-top: 1px dashed #dadce0;
}
.editor__row {
  display: flex; gap: 6px; align-items: center; margin-bottom: 8px; flex-wrap: wrap;
}
.editor__label {
  font-size: 10px; color: #5f6368;
  text-transform: uppercase; letter-spacing: 0.04em;
  min-width: 70px;
}
.editor__swatch {
  width: 22px; height: 22px; border-radius: 50%;
  border: 2px solid transparent; padding: 0;
  background-clip: padding-box;
}
.editor__swatch--active { border-color: #202124; }
.editor__swatch--none {
  background: #fff; border: 2px dashed #5f6368;
  font-size: 10px; color: #5f6368;
  display: flex; align-items: center; justify-content: center; line-height: 1;
}
.editor__note {
  width: 100%; border: 1px solid #dadce0; border-radius: 4px;
  padding: 6px 8px; font: inherit; font-size: 12px;
  resize: vertical; min-height: 48px;
}
.editor__buttons { display: flex; gap: 6px; justify-content: flex-end; }
.editor__btn {
  font-size: 11px; padding: 4px 10px; border-radius: 4px;
  border: 1px solid #dadce0; background: #fff; color: #202124;
}
.editor__btn--primary {
  background: #1a73e8; border-color: #1a73e8; color: #fff;
}
`;

const OpsSidebar = (function () {
  const state = {
    pageHighlights: [],   // [{ highlightId, sourceId, primaryCategory, color, text, note, secondaryCategory, syncStatus }]
    hostEl: null,
    shadowRoot: null,
    panelEl: null,
    listEl: null,
    launcherEl: null,
    project: null,
    bundle: null,
    filter: null,         // null | category label
    editingId: null,      // highlightId currently being edited
    altPickerOpenId: null, // highlightId whose alt-pill picker is open
    initialized: false,
  };

  // ---------- public API ----------

  async function addHighlight(h) {
    await ensureInit_();
    state.pageHighlights.push({ ...h, syncStatus: 'pending' });
    show();
    render_();
  }

  function markSynced(highlightId) {
    const h = state.pageHighlights.find((x) => x.highlightId === highlightId);
    if (!h) return;
    h.syncStatus = 'saved';
    render_();
  }

  function markError(highlightId, msg) {
    const h = state.pageHighlights.find((x) => x.highlightId === highlightId);
    if (!h) return;
    h.syncStatus = 'error';
    h.errorMsg = msg;
    render_();
  }

  async function focus(highlightId) {
    await ensureInit_();
    show();
    // Wait for render so the element exists.
    setTimeout(() => {
      const card = state.shadowRoot.querySelector(`[data-highlight-id="${highlightId}"]`);
      if (!card) return;
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      card.classList.remove('entry--flash');
      void card.offsetWidth; // restart animation
      card.classList.add('entry--flash');
    }, 30);
  }

  async function show() {
    await ensureInit_();
    state.panelEl.style.display = 'flex';
    state.launcherEl.style.display = 'none';
    render_();
  }

  async function hide() {
    await ensureInit_();
    state.panelEl.style.display = 'none';
    state.launcherEl.style.display = state.pageHighlights.length ? 'flex' : 'none';
    render_();
  }

  async function toggle() {
    await ensureInit_();
    if (state.panelEl.style.display === 'none') show();
    else hide();
  }

  // ---------- init / shadow DOM ----------

  async function ensureInit_() {
    if (state.initialized) return;
    state.initialized = true;
    await loadContext_();
    await buildHost_();
    render_();
  }

  /**
   * Public: load any server-persisted highlights for the current page into
   * the sidebar (called on page-load bootstrap). No-op if nothing's saved.
   * Doesn't re-anchor anything on the page — sidebar-only.
   */
  async function loadForCurrentPage() {
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ type: 'loadPageHighlights', rawUrl: location.href });
    } catch (e) {
      return; // offline / backend down; nothing to do
    }
    if (!resp || !resp.ok || !resp.highlights || resp.highlights.length === 0) return;
    await ensureInit_();
    resp.highlights.forEach((h) => {
      if (state.pageHighlights.some((x) => x.highlightId === h.highlightId)) return;
      state.pageHighlights.push({
        highlightId: h.highlightId,
        sourceId: h.sourceId,
        primaryCategory: h.primaryCategory,
        secondaryCategory: h.secondaryCategory || '',
        text: h.highlightedText,
        note: h.note || '',
        color: colorForLabel_(h.primaryCategory) || '#fff8c4',
        syncStatus: 'saved',
      });
    });

    // Try to re-anchor on the page so the colored spans come back too.
    // Failures are surfaced per-entry in the sidebar; no silent misanchoring.
    if (self.reAnchorHighlights) {
      const colorWithFallback = (label) => colorForLabel_(label) || '#fff8c4';
      const { failed } = self.reAnchorHighlights(resp.highlights, colorWithFallback);
      const failedSet = new Set(failed);
      state.pageHighlights.forEach((h) => {
        if (failedSet.has(h.highlightId)) h.notFoundOnPage = true;
      });
    }

    // Make the launcher visible so the student knows their work is still
    // there. Don't auto-open the full panel — they may not want it on
    // every page reload.
    state.launcherEl.style.display = 'flex';
    render_();
  }

  async function loadContext_() {
    try {
      const ctx = await chrome.runtime.sendMessage({ type: 'getActiveProject' });
      if (ctx && ctx.ok) {
        state.project = ctx.project;
        state.bundle = ctx.bundle;
      }
    } catch (e) {
      console.warn('[OPS sidebar] could not load active project:', e);
    }
  }

  async function buildHost_() {
    state.hostEl = document.createElement('div');
    state.hostEl.id = '__ops_research_sidebar_host';
    state.hostEl.style.cssText = 'all: initial; position: fixed; top: 0; right: 0; z-index: 2147483647;';
    state.shadowRoot = state.hostEl.attachShadow({ mode: 'open' });
    document.documentElement.appendChild(state.hostEl);

    // Inline CSS — fetching from chrome.runtime.getURL was failing silently
    // on some host pages, leaving the sidebar unstyled and inlined into
    // page flow.
    const styleEl = document.createElement('style');
    styleEl.textContent = SIDEBAR_CSS;
    state.shadowRoot.appendChild(styleEl);

    // Root container + launcher + panel structure (panel innards rendered dynamically).
    const root = document.createElement('div');
    root.className = 'root';
    state.shadowRoot.appendChild(root);

    state.launcherEl = document.createElement('button');
    state.launcherEl.className = 'launcher';
    state.launcherEl.type = 'button';
    state.launcherEl.style.display = 'none';
    state.launcherEl.addEventListener('click', () => show());
    root.appendChild(state.launcherEl);

    state.panelEl = document.createElement('div');
    state.panelEl.className = 'panel';
    state.panelEl.style.display = 'none';
    root.appendChild(state.panelEl);
  }

  // ---------- render ----------

  function render_() {
    if (!state.shadowRoot) return;
    // Preserve the list's scroll position across re-renders. renderPanel_
    // replaces innerHTML, which destroys the .list element and resets scroll
    // — annoying when a user is mid-list and toggles the Alt picker or Edit.
    const prevScrollTop = state.listEl ? state.listEl.scrollTop : 0;
    renderLauncher_();
    renderPanel_();
    if (state.listEl) state.listEl.scrollTop = prevScrollTop;
  }

  function renderLauncher_() {
    const visibleCount = state.pageHighlights.length;
    state.launcherEl.innerHTML = '';
    const label = document.createElement('span');
    label.textContent = 'OPS';
    state.launcherEl.appendChild(label);
    if (visibleCount > 0) {
      const c = document.createElement('span');
      c.className = 'launcher__count';
      c.textContent = String(visibleCount);
      state.launcherEl.appendChild(c);
    }
  }

  function renderPanel_() {
    state.panelEl.innerHTML = '';

    // Header
    const hdr = el_('div', 'panel__header');
    const title = el_('div', 'panel__title', 'Research notes');
    const close = el_('button', 'panel__close');
    close.type = 'button';
    close.textContent = '×';
    close.title = 'Close';
    close.addEventListener('click', () => hide());
    hdr.appendChild(title);
    hdr.appendChild(close);
    state.panelEl.appendChild(hdr);

    // Subheader (project info)
    const sub = el_('div', 'panel__sub');
    sub.textContent = state.project
      ? 'Saving to: ' + state.project.name
      : 'No active project — pick one from the extension toolbar.';
    state.panelEl.appendChild(sub);

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
  }

  function makeFilterChip_(value, label, color, count) {
    const chip = el_('button', 'filter-chip');
    chip.type = 'button';
    if (state.filter === value) chip.classList.add('filter-chip--active');
    const dot = el_('span', 'filter-chip__dot');
    dot.style.backgroundColor = color;
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(label));
    const c = el_('span', 'filter-chip__count');
    c.textContent = String(count);
    chip.appendChild(c);
    chip.addEventListener('click', () => {
      state.filter = state.filter === value ? null : value;
      render_();
    });
    return chip;
  }

  function renderEntry_(h) {
    const entry = el_('div', 'entry');
    entry.setAttribute('data-highlight-id', h.highlightId);

    const bar = el_('div', 'entry__color-bar');
    bar.style.backgroundColor = h.color || '#dadce0';
    entry.appendChild(bar);

    const cat = el_('div', 'entry__cat');
    cat.appendChild(document.createTextNode(h.primaryCategory || '(uncategorized)'));
    if (h.notFoundOnPage) {
      const warn = el_('span', 'entry__warn');
      warn.textContent = '↯ page changed';
      warn.title = 'Could not locate this exact text on the page. It may have been edited or moved since the highlight was saved. The highlight is still in your project — only the on-page mark is missing.';
      cat.appendChild(warn);
    }
    entry.appendChild(cat);

    const text = el_('div', 'entry__text');
    text.textContent = truncate_(h.text || '', 220);
    text.title = 'Click to jump to this highlight on the page';
    text.addEventListener('click', () => scrollToMark_(h.highlightId));
    entry.appendChild(text);

    if (h.note) {
      const note = el_('div', 'entry__note');
      note.textContent = h.note;
      entry.appendChild(note);
    }

    const actions = el_('div', 'entry__actions');
    const sync = el_('span', 'entry__sync entry__sync--' + (h.syncStatus || 'pending'));
    sync.textContent = ({
      pending: '⌛ saving…',
      saved:   '✓ saved',
      error:   '⚠ ' + (h.errorMsg || 'save failed'),
    })[h.syncStatus || 'pending'];
    actions.appendChild(sync);

    const right = el_('div', 'entry__actions-right');

    // Alt pill — same shape as filter chips, with a colored dot showing
    // the current secondary tag. Click to open the inline picker.
    const altPill = el_('button', 'entry__alt-pill');
    altPill.type = 'button';
    const altDot = el_('span', 'entry__alt-pill__dot');
    if (h.secondaryCategory) {
      altDot.classList.add('entry__alt-pill__dot--set');
      const c = colorForLabel_(h.secondaryCategory);
      if (c) altDot.style.setProperty('background-color', c, 'important');
    }
    altPill.appendChild(altDot);
    altPill.appendChild(document.createTextNode('Alt: ' + (h.secondaryCategory || 'None')));
    if (h.secondaryCategory) altPill.classList.add('entry__alt-pill--set');
    altPill.addEventListener('click', (e) => {
      e.stopPropagation();
      state.altPickerOpenId = state.altPickerOpenId === h.highlightId ? null : h.highlightId;
      render_();
    });
    right.appendChild(altPill);

    const edit = el_('button', 'entry__edit-toggle');
    edit.type = 'button';
    edit.textContent = state.editingId === h.highlightId ? 'Done' : 'Edit';
    edit.addEventListener('click', () => {
      state.editingId = state.editingId === h.highlightId ? null : h.highlightId;
      render_();
    });
    right.appendChild(edit);

    actions.appendChild(right);
    entry.appendChild(actions);

    if (state.altPickerOpenId === h.highlightId && state.bundle) {
      entry.appendChild(renderAltPicker_(h));
    }
    if (state.editingId === h.highlightId) {
      entry.appendChild(renderEditor_(h));
    }

    return entry;
  }

  function colorForLabel_(label) {
    if (!state.bundle) return null;
    for (let i = 1; i <= 5; i++) {
      if (state.bundle['label' + i] === label) return state.bundle['color' + i];
    }
    return null;
  }

  function renderAltPicker_(h) {
    const picker = el_('div', 'entry__alt-picker');
    const none = el_('button', 'entry__alt-pick-btn entry__alt-pick-btn--none');
    none.type = 'button';
    none.textContent = '∅';
    none.title = 'No alternative tag';
    if (!h.secondaryCategory) none.classList.add('entry__alt-pick-btn--active');
    none.addEventListener('click', () => setSecondary_(h, ''));
    picker.appendChild(none);
    for (let i = 1; i <= 5; i++) {
      const label = state.bundle['label' + i];
      const color = state.bundle['color' + i];
      if (!label) continue;
      const sw = el_('button', 'entry__alt-pick-btn');
      sw.type = 'button';
      sw.title = label;
      sw.style.setProperty('background-color', color, 'important');
      if (h.secondaryCategory === label) sw.classList.add('entry__alt-pick-btn--active');
      sw.addEventListener('click', () => setSecondary_(h, label));
      picker.appendChild(sw);
    }
    return picker;
  }

  function setSecondary_(h, label) {
    h.secondaryCategory = label;
    state.altPickerOpenId = null;
    enqueueUpdate_(h);
    render_();
  }

  function renderEditor_(h) {
    const editor = el_('div', 'editor');

    // Primary category row
    if (state.bundle) {
      const row1 = el_('div', 'editor__row');
      row1.appendChild(el_('div', 'editor__label', 'Category'));
      for (let i = 1; i <= 5; i++) {
        const label = state.bundle['label' + i];
        const color = state.bundle['color' + i];
        if (!label) continue;
        const sw = el_('button', 'editor__swatch');
        sw.type = 'button';
        sw.style.backgroundColor = color;
        sw.title = label;
        if (h.primaryCategory === label) sw.classList.add('editor__swatch--active');
        sw.addEventListener('click', () => {
          h.primaryCategory = label;
          h.color = color;
          // Repaint the page mark color too.
          updateMarkColor_(h.highlightId, color);
          enqueueUpdate_(h);
          render_();
        });
        row1.appendChild(sw);
      }
      editor.appendChild(row1);

      // Secondary row (5 + none)
      const row2 = el_('div', 'editor__row');
      row2.appendChild(el_('div', 'editor__label', 'Secondary'));
      for (let i = 1; i <= 5; i++) {
        const label = state.bundle['label' + i];
        const color = state.bundle['color' + i];
        if (!label) continue;
        const sw = el_('button', 'editor__swatch');
        sw.type = 'button';
        sw.style.backgroundColor = color;
        sw.title = label;
        if (h.secondaryCategory === label) sw.classList.add('editor__swatch--active');
        sw.addEventListener('click', () => {
          h.secondaryCategory = h.secondaryCategory === label ? '' : label;
          enqueueUpdate_(h);
          render_();
        });
        row2.appendChild(sw);
      }
      const none = el_('button', 'editor__swatch editor__swatch--none');
      none.type = 'button';
      none.textContent = '∅';
      none.title = 'no secondary';
      if (!h.secondaryCategory) none.classList.add('editor__swatch--active');
      none.addEventListener('click', () => {
        h.secondaryCategory = '';
        enqueueUpdate_(h);
        render_();
      });
      row2.appendChild(none);
      editor.appendChild(row2);
    }

    // Note
    const noteWrap = el_('div', 'editor__row');
    noteWrap.style.flexDirection = 'column';
    noteWrap.style.alignItems = 'stretch';
    noteWrap.appendChild(el_('div', 'editor__label', 'Note'));
    const ta = document.createElement('textarea');
    ta.className = 'editor__note';
    ta.value = h.note || '';
    ta.placeholder = 'add an optional note…';
    let timer;
    ta.addEventListener('input', () => {
      clearTimeout(timer);
      h.note = ta.value;
      timer = setTimeout(() => enqueueUpdate_(h), 600);
    });
    noteWrap.appendChild(ta);
    editor.appendChild(noteWrap);

    return editor;
  }

  // ---------- helpers ----------

  function countByCategory_(cat) {
    if (!cat) return state.pageHighlights.length;
    return state.pageHighlights.filter((h) => h.primaryCategory === cat || h.secondaryCategory === cat).length;
  }

  function filteredHighlights_() {
    if (!state.filter) return state.pageHighlights;
    return state.pageHighlights.filter(
      (h) => h.primaryCategory === state.filter || h.secondaryCategory === state.filter
    );
  }

  function scrollToMark_(highlightId) {
    const mark = document.querySelector(`.${MARK_CLASS}[${MARK_ATTR}="${highlightId}"]`);
    if (mark) {
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const oldOutline = mark.style.outline;
      mark.style.outline = '2px solid #1a73e8';
      mark.style.outlineOffset = '2px';
      setTimeout(() => { mark.style.outline = oldOutline; }, 1200);
      return;
    }
    // No live mark (server-loaded highlight after a reload) — best-effort
    // text search so the student can still find their highlight on the page.
    const h = state.pageHighlights.find((x) => x.highlightId === highlightId);
    if (h && h.text) scrollToHighlightText_(h.text);
  }

  function scrollToHighlightText_(text) {
    const needle = (text || '').slice(0, 80).trim();
    if (!needle) return;
    const walker = document.createTreeWalker(
      document.body, NodeFilter.SHOW_TEXT,
      { acceptNode: (n) => {
        const parent = n.parentNode;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.nodeName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
        return n.textContent.includes(needle) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }}
    );
    const node = walker.nextNode();
    if (!node) return;
    const idx = node.textContent.indexOf(needle);
    try {
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + Math.min(needle.length, node.length - idx));
      const rect = range.getBoundingClientRect();
      if (rect.height > 0) {
        window.scrollTo({
          top: window.scrollY + rect.top - window.innerHeight / 2,
          behavior: 'smooth',
        });
      }
      const target = node.parentElement;
      if (target) {
        const oldBg = target.style.backgroundColor;
        const oldTransition = target.style.transition;
        target.style.transition = 'background-color 0.8s';
        target.style.backgroundColor = '#fff4a3';
        setTimeout(() => {
          target.style.backgroundColor = oldBg;
          target.style.transition = oldTransition;
        }, 1200);
      }
    } catch (e) {
      // ignore
    }
  }

  function updateMarkColor_(highlightId, color) {
    document.querySelectorAll(`.${MARK_CLASS}[${MARK_ATTR}="${highlightId}"]`).forEach((sp) => {
      sp.style.backgroundColor = color;
    });
  }

  function enqueueUpdate_(h) {
    // Re-send the full highlight; backend's upsertByKey keys on highlightId,
    // so this overwrites in place. Mark as pending again until drain confirms.
    h.syncStatus = 'pending';
    render_();
    chrome.runtime.sendMessage({
      type: 'enqueueHighlight',
      highlight: {
        highlightId: h.highlightId,
        sourceId: h.sourceId,
        primaryCategory: h.primaryCategory,
        secondaryCategory: h.secondaryCategory || '',
        highlightedText: h.text,
        note: h.note || '',
      },
    }).then(() => markSynced(h.highlightId)).catch((e) => markError(h.highlightId, e.message));
  }

  function el_(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function truncate_(s, n) {
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  // Internal: lets toolbar.js backfill the sourceId once
  // getOrCreateSourceId resolves, so subsequent edits include it.
  function _setSourceId(highlightId, sourceId) {
    const h = state.pageHighlights.find((x) => x.highlightId === highlightId);
    if (h) h.sourceId = sourceId;
  }

  return { addHighlight, markSynced, markError, focus, show, hide, toggle, _setSourceId, loadForCurrentPage };
})();

self.OpsSidebar = OpsSidebar;

// Kick a server load on every page load so the sidebar reflects saved work
// even after the page reloads. Fires once per content script instance. Best-
// effort — fails silently if offline or no active project.
OpsSidebar.loadForCurrentPage();
