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
    state.hostEl.style.cssText = 'all: initial; position: relative; z-index: 2147483647;';
    state.shadowRoot = state.hostEl.attachShadow({ mode: 'open' });
    document.documentElement.appendChild(state.hostEl);

    // Inject CSS into the shadow root.
    try {
      const resp = await fetch(chrome.runtime.getURL('content/sidebar.css'));
      const css = await resp.text();
      const styleEl = document.createElement('style');
      styleEl.textContent = css;
      state.shadowRoot.appendChild(styleEl);
    } catch (e) {
      console.warn('[OPS sidebar] css load failed:', e);
    }

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
    renderLauncher_();
    renderPanel_();
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
    cat.textContent = h.primaryCategory || '(uncategorized)';
    if (h.secondaryCategory) {
      const sec = el_('span', 'entry__secondary');
      sec.textContent = '+ ' + h.secondaryCategory;
      cat.appendChild(sec);
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

    const edit = el_('button', 'entry__edit-toggle');
    edit.type = 'button';
    edit.textContent = state.editingId === h.highlightId ? 'Done' : 'Edit';
    edit.addEventListener('click', () => {
      state.editingId = state.editingId === h.highlightId ? null : h.highlightId;
      render_();
    });
    actions.appendChild(edit);
    entry.appendChild(actions);

    if (state.editingId === h.highlightId) {
      entry.appendChild(renderEditor_(h));
    }

    return entry;
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
      // Brief outline flash so the user can tell what they jumped to.
      const oldOutline = mark.style.outline;
      mark.style.outline = '2px solid #1a73e8';
      mark.style.outlineOffset = '2px';
      setTimeout(() => { mark.style.outline = oldOutline; }, 1200);
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

  return { addHighlight, markSynced, markError, focus, show, hide, toggle, _setSourceId };
})();

self.OpsSidebar = OpsSidebar;
