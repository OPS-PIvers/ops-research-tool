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

/* Slim bookmark-style tab tucked to the right edge. OPS Primary Blue,
   semi-transparent at rest so it recedes into the page; brightens and
   nudges out on hover/focus. A pen glyph marks it as the highlight/annotate
   surface — no text, so it stays compact and language-neutral. */
.launcher {
  position: fixed; top: 50%; right: 0; transform: translateY(-50%);
  background: #2d3f89; color: #fff; border: none;
  border-radius: 8px 0 0 8px; padding: 11px 7px;
  box-shadow: -1px 1px 5px rgba(29,42,93,0.22);
  display: flex; flex-direction: column; align-items: center; gap: 7px;
  opacity: 0.6;
  transition: opacity 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease;
}
.launcher:hover {
  opacity: 1; transform: translateY(-50%) translateX(-3px);
  box-shadow: -2px 2px 12px rgba(29,42,93,0.34);
}
.launcher:focus-visible {
  opacity: 1; outline: none;
  box-shadow: -2px 2px 12px rgba(29,42,93,0.34), 0 0 0 2px rgba(67,86,160,0.9);
}
.launcher__icon {
  width: 18px; height: 18px; display: block; flex: none;
}
.launcher__count {
  background: rgba(255,255,255,0.22); border-radius: 999px;
  padding: 2px 6px; font-size: 10px; font-weight: 700;
}

.panel {
  position: fixed; top: 0; right: 0;
  width: 360px; height: 100vh; max-height: 100vh;
  background: #fff; border-left: 1px solid #dadce0;
  box-shadow: -4px 0 16px rgba(0,0,0,0.08);
  display: flex; flex-direction: column;
}
/* Branded header — OPS Primary Blue, Lexend; mirrors the edge launcher tab so
   the panel reads as the same on-brand surface. */
.panel__header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 11px 14px; background: #2d3f89; color: #fff;
}
.panel__brand {
  font-family: "Lexend", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-weight: 600; font-size: 14px; letter-spacing: 0.01em; color: #fff;
}
/* Right-pointing control = collapse the panel back into the edge tab (not a
   destructive close). */
.panel__collapse {
  background: rgba(255,255,255,0.14); border: none; color: #fff;
  font-size: 16px; line-height: 1; width: 26px; height: 26px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s ease;
}
.panel__collapse:hover { background: rgba(255,255,255,0.28); }
.panel__collapse:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(255,255,255,0.75); }
.panel__project {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px; border-bottom: 1px solid #dadce0;
}
.panel__project-label {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;
  color: #5f6368; flex: none;
}
.panel__project-select {
  flex: 1; min-width: 0; border: 1px solid #dadce0; border-radius: 6px;
  padding: 5px 8px; font: inherit; font-size: 12px; color: #202124; background: #fff;
}

.list { flex: 1; overflow-y: auto; padding: 8px 0; min-height: 0; }
.list__empty {
  padding: 24px 14px; text-align: center;
  color: #5f6368; font-size: 12px; line-height: 1.5;
}

/* Skeleton placeholder rows shown while a page-open / project-switch fetch is
   in flight, so the list reads as "loading" instead of falsely "empty". A light
   sweep animates across a neutral-gray base; honors prefers-reduced-motion. */
.skel {
  position: relative; margin: 6px 12px; padding: 10px 12px 10px 16px;
  background: #fff; border: 1px solid #ecedef; border-radius: 6px;
}
.skel__bar {
  position: absolute; top: 8px; bottom: 8px; left: 4px;
  width: 4px; border-radius: 2px; background: #e8eaed;
}
.skel__line {
  height: 9px; border-radius: 4px; margin-bottom: 8px;
  background-color: #eceff1;
  background-image: linear-gradient(90deg,
    rgba(255,255,255,0) 0, rgba(255,255,255,0.65) 50%, rgba(255,255,255,0) 100%);
  background-repeat: no-repeat; background-size: 140px 100%;
  animation: opsShimmer 1.3s ease-in-out infinite;
}
.skel__line:last-child { margin-bottom: 0; }
.skel__line--cat { width: 40%; height: 8px; margin-bottom: 10px; }
.skel__line--full { width: 100%; }
.skel__line--short { width: 78%; }
@keyframes opsShimmer {
  0% { background-position: -140px 0; }
  100% { background-position: calc(100% + 140px) 0; }
}
@media (prefers-reduced-motion: reduce) {
  .skel__line { animation: none; }
}
/* Source-tab skeleton: stacked label + field placeholders, shown only while a
   fetch is in flight and the page's source hasn't arrived yet. */
.skel-src { padding: 12px 14px 16px; }
.skel-src__fld { margin-bottom: 13px; }
.skel__line--label { width: 32%; height: 7px; margin-bottom: 7px; }
.skel__line--input { width: 100%; height: 30px; border-radius: 6px; }
.skel__line--ta { width: 100%; height: 52px; border-radius: 6px; }

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
.entry__delete-toggle {
  background: none; border: none; color: #d93025;
  font-size: 11px; padding: 2px 6px;
}
.entry__delete-toggle--confirming {
  background: #d93025; color: #fff;
  border-radius: 4px; font-weight: 500;
  padding: 2px 8px;
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
.src { padding:10px 14px 16px; overflow-y:auto; }
.src__empty { padding:24px 14px; text-align:center; color:#5f6368; font-size:12px; line-height:1.5; }
.src__fld { margin-bottom:9px; }
.src__fld label { display:block; font-size:10px; text-transform:uppercase; letter-spacing:0.04em; color:#80868b; margin-bottom:3px; }
.src__fld input, .src__fld select {
  width:100%; border:1px solid #dadce0; border-radius:6px; padding:6px 8px; font:inherit; font-size:12.5px; color:#202124; background:#fff;
}
.src__seg { display:flex; border:1px solid #dadce0; border-radius:7px; overflow:hidden; }
.src__seg button { flex:1; border:none; border-right:1px solid #eceff1; background:#fff; padding:7px 4px; font-size:12px; color:#5f6368; text-align:center; }
.src__seg button:last-child { border-right:none; }
.src__seg button.src__seg--on { background:#e8f0fe; color:#1a73e8; font-weight:600; }
.src__ta { width:100%; border:1px solid #dadce0; border-radius:6px; padding:6px 8px; font:inherit; font-size:12.5px; min-height:48px; resize:vertical; }
.src__preview { margin-top:10px; padding:9px 11px; background:#f8f9fa; border:1px solid #eceff1; border-radius:7px; font-size:11.5px; line-height:1.5; color:#3c4043; }
.src__preview-lbl { display:block; font-size:9.5px; text-transform:uppercase; letter-spacing:0.05em; color:#9aa0a6; margin-bottom:3px; }
.src__status { font-size:10.5px; color:#0f9d58; margin-top:8px; min-height:14px; }
.src__status--pending { color:#b06000; }
.src__status--error { color:#d93025; }
/* Subtle per-source evidence-target nudge (shown only when this project sets a
   minHighlightsPerSource / minDistinctCategories requirement). */
.src__hint { font-size:10.5px; color:#80868b; margin-top:6px; line-height:1.4; }
.facet__hint { padding:2px 8px 6px; font-size:10.5px; color:#80868b; line-height:1.4; }
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

/* Orphaned-content-script alert: shown once when an extension reload/auto-update
   has severed this page's connection to the background (saving can't resume
   until reload). OPS red = needs attention. Lives in the shadow host so it shows
   whether the panel is open or collapsed. */
.reload-hint {
  position: fixed; bottom: 16px; right: 16px; max-width: 280px; z-index: 10;
  background: #ad2122; color: #fff; border-radius: 8px; padding: 11px 13px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.28); font-size: 12px; line-height: 1.45;
  display: flex; flex-direction: column; gap: 8px;
  font-family: "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.reload-hint__actions { display:flex; gap:8px; justify-content:flex-end; }
.reload-hint__btn { font:inherit; font-size:11px; padding:4px 10px; border-radius:5px; border:none; cursor:pointer; }
.reload-hint__btn--reload { background:#fff; color:#ad2122; font-weight:600; }
.reload-hint__btn--dismiss { background:rgba(255,255,255,0.18); color:#fff; }
`;

// True when this content script has been orphaned by an extension reload or
// auto-update: chrome.runtime is gone, so any chrome.* call throws "Extension
// context invalidated" and chrome.runtime.id reads back undefined. Saving can't
// resume until the page is reloaded (which re-injects fresh content scripts).
// Top-level so toolbar.js can share it (content scripts share one frame scope).
function opsIsContextInvalidated_(e) {
  try { if (!chrome.runtime || !chrome.runtime.id) return true; } catch (_) { return true; }
  const msg = String((e && e.message) || e || '');
  return msg.indexOf('Extension context invalidated') !== -1 ||
         msg.indexOf('context invalidated') !== -1;
}

const OpsSidebar = (function () {
  const state = {
    pageHighlights: [],   // [{ highlightId, sourceId, primaryCategory, color, text, note, secondaryCategory, syncStatus }]
    hostEl: null,
    shadowRoot: null,
    panelEl: null,
    listEl: null,
    launcherEl: null,
    project: null,
    projects: [],         // all active projects the student belongs to (drives the picker)
    bundle: null,
    filter: null,         // null | category label
    loadingHighlights: false, // true while a page-open / project-switch fetch is in flight (drives skeleton)
    editingId: null,      // highlightId currently being edited
    altPickerOpenId: null, // highlightId whose alt-pill picker is open
    confirmingDeleteId: null, // highlightId whose Delete button is showing "Confirm?"
    confirmingDeleteTimer: null,
    initialized: false,
    reloadHintShown: false, // one-time "extension updated — reload to keep saving" banner
    activeTab: 'annotations', // 'source' | 'annotations'
    pageSource: null, // canonical source object for this page (server + local scrape)
    sourceSaveStatus: null,
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
    // Open IMMEDIATELY from whatever context we already have — never gate the
    // panel behind a network round-trip. A cold GAS call here used to make the
    // launcher click feel dead for seconds; the panel now paints at once and the
    // project/bundle fill in a moment later if they weren't cached yet.
    state.panelEl.style.display = 'flex';
    state.launcherEl.style.display = 'none';
    render_();
    if (!state.project || !state.bundle) {
      loadContext_().then(() => render_()).catch(() => {});
    }
  }

  async function hide() {
    await ensureInit_();
    state.panelEl.style.display = 'none';
    // Always restore the edge tab so the panel can be reopened — it's the
    // persistent "active here" launcher, not gated on highlight count (a
    // page opened from the tab with zero highlights must still re-collapse
    // to a clickable tab, not vanish until reload).
    state.launcherEl.style.display = 'flex';
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
    // Build + paint the shadow host (launcher + empty panel) FIRST, so the edge
    // tab appears the instant the page settles instead of waiting on a (possibly
    // cold) GAS round-trip. render_ tolerates a null project/bundle, so resolve
    // context in the BACKGROUND and re-render when it lands.
    await buildHost_();
    if (self.OpsEnabled) {
      // The storage read behind get() is async — wait for it to settle so a
      // student who left the extension ON isn't treated as OFF on page load.
      await self.OpsEnabled.ready();
      applyEnabled_(self.OpsEnabled.get());
      // Live toggle: hide/show the whole host. Re-enabling re-runs
      // loadForCurrentPage so a page enabled mid-session still fetches its
      // saved highlights (the initial run bailed before the network call).
      self.OpsEnabled.onChange((on) => {
        applyEnabled_(on);
        if (on) loadForCurrentPage();
      });
    }
    render_();
    loadContext_().then(() => render_()).catch(() => {});
  }

  // Hide every on-page surface when the extension is switched off. The host
  // holds both the launcher and the panel, so toggling its display silences
  // everything at once; the inner launcher/panel display state is preserved
  // for when it comes back. Absent in the PDF panel = never gated.
  function applyEnabled_(on) {
    if (!state.hostEl) return;
    state.hostEl.style.display = on ? '' : 'none';
  }

  /**
   * Public: bootstrap the sidebar on every page load. Always inits the
   * shadow host + shows the right-edge launcher so the student has a
   * visible "OPS Research Tool is active here" signal even on pages
   * they haven't highlighted anything on yet. Then fetches any
   * server-persisted highlights for the page's URL and loads them in.
   */
  async function loadForCurrentPage() {
    await ensureInit_();
    // Dormant when the student has switched the extension off. ensureInit_
    // already hid the host; skip the launcher + network fetch entirely. The
    // onChange handler re-invokes this when they switch it back on. Await the
    // settled value — sampling get() before the storage read resolves would
    // read the optimistic OFF and bail even when the extension is ON.
    if (self.OpsEnabled) {
      await self.OpsEnabled.ready();
      if (!self.OpsEnabled.get()) return;
    }
    state.launcherEl.style.display = 'flex';
    state.launcherEl.title = 'OPS Research Tool — click to open the research panel';
    // Enter the loading state so the list shows skeleton rows (not a false
    // "empty") while we fetch. The finally clears it on every exit path —
    // success, offline, or backend error — so the skeleton never sticks.
    state.loadingHighlights = true;
    render_();

    if (_loadRetryTimer) { clearTimeout(_loadRetryTimer); _loadRetryTimer = null; }
    const urlAtStart = normalizeUrl(opsPageUrl());

    try {
      let resp;
      try {
        resp = await chrome.runtime.sendMessage({ type: 'loadPageHighlights', rawUrl: opsPageUrl() });
      } catch (e) {
        if (opsIsContextInvalidated_(e)) { showReloadHint_(); return; }
        resp = null; // service worker asleep / messaging hiccup — retry below
      }
      // The page navigated (SPA) while we were waiting — that load is stale;
      // the URL watcher has already kicked a fresh one.
      if (normalizeUrl(opsPageUrl()) !== urlAtStart) return;

      // Even a failed fetch can carry the not-yet-synced local queue (so the
      // student's just-captured work is never blank); apply whatever came back.
      if (resp && (resp.highlights || resp.source)) applyPageView_(resp, !!resp.ok);

      if (!resp || !resp.ok || resp.noProject) {
        // Offline, backend cold/down, or the project list hasn't resolved yet.
        // The old code returned silently here and never tried again — the
        // student saw an empty list until a manual reload. Retry with backoff.
        scheduleLoadRetry_();
        return;
      }
      _loadAttempt = 0;
    } finally {
      state.loadingHighlights = false;
      render_();
    }
  }

  // Bounded retry for a failed page load: 3 attempts spaced out so a cold
  // service worker / slow backend recovers without hammering it.
  const LOAD_RETRY_DELAYS_MS = [2500, 7000, 20000];
  let _loadAttempt = 0;
  let _loadRetryTimer = null;

  function scheduleLoadRetry_() {
    if (_loadAttempt >= LOAD_RETRY_DELAYS_MS.length) return;
    const delay = LOAD_RETRY_DELAYS_MS[_loadAttempt++];
    _loadRetryTimer = setTimeout(() => {
      _loadRetryTimer = null;
      loadForCurrentPage().catch(() => {});
    }, delay);
  }

  /**
   * Merge a page view ({ source, highlights }) from the background into state.
   * Used by the initial load, retries, and `pageHighlightsUpdated` pushes (the
   * background refreshes the project snapshot after serving the cache).
   *
   * - New entries are added; entries this session created stay untouched.
   * - Server-loaded entries are refreshed (category / note / secondary).
   * - With `reconcile`, server-loaded entries missing from an authoritative
   *   view are dropped (deleted from the Docs sidebar / another device) so the
   *   panel doesn't keep showing work that no longer exists.
   * - Rows flagged `_pending` (still in the offline queue) show "saving…".
   */
  function applyPageView_(resp, reconcile) {
    if (resp.source) {
      const incoming = normalizeSourceObj_(resp.source);
      const dirty = state.pageSource
        && state.pageSource.sourceId === incoming.sourceId
        && state.sourceSaveStatus === 'pending';
      if (!dirty) state.pageSource = incoming;
    }
    const list = resp.highlights || [];
    const incomingIds = new Set(list.map((h) => h.highlightId));
    let added = 0;
    list.forEach((h) => {
      const existing = state.pageHighlights.find((x) => x.highlightId === h.highlightId);
      if (existing) {
        if (existing.fromServer && state.editingId !== h.highlightId) {
          existing.primaryCategory = h.primaryCategory;
          existing.secondaryCategory = h.secondaryCategory || '';
          existing.note = h.note || '';
          existing.color = colorForLabel_(h.primaryCategory) || '#fff8c4';
          existing.syncStatus = h._pending ? 'pending' : 'saved';
        }
        return;
      }
      added++;
      state.pageHighlights.push({
        highlightId: h.highlightId,
        sourceId: h.sourceId,
        primaryCategory: h.primaryCategory,
        secondaryCategory: h.secondaryCategory || '',
        text: h.highlightedText,
        note: h.note || '',
        color: colorForLabel_(h.primaryCategory) || '#fff8c4',
        syncStatus: h._pending ? 'pending' : 'saved',
        fromServer: true,
      });
    });
    if (reconcile) {
      const gone = state.pageHighlights.filter((x) => x.fromServer && !incomingIds.has(x.highlightId));
      if (gone.length) {
        gone.forEach((x) => { if (self.unwrapMark) self.unwrapMark(x.highlightId); });
        state.pageHighlights = state.pageHighlights.filter((x) => gone.indexOf(x) < 0);
      }
    }

    // Try to re-anchor on the page so the colored spans come back too.
    // Failures are surfaced per-entry in the sidebar; no silent misanchoring.
    // Always pass the FULL current set (reAnchor is idempotent) so an earlier
    // entry's "page changed" flag isn't cleared by a pass that omits it.
    //
    // Defer mode (OPS_DEFER_REANCHOR === true, set by the PDF panel before
    // this script loads) skips the document-wide walk because the host
    // renders content lazily — the panel will call reanchorIn() once per
    // page as it comes on screen. Without this we'd mark every highlight
    // as "page changed" on first load, since no pages are in the DOM yet.
    if (added > 0 && self.reAnchorHighlights && !self.OPS_DEFER_REANCHOR) {
      scheduleReanchorRetries_(allForReanchor_());
    }
    if (!isEditingInPanel_()) render_();
  }

  function allForReanchor_() {
    return state.pageHighlights.map((h) => ({
      highlightId: h.highlightId,
      primaryCategory: h.primaryCategory,
      secondaryCategory: h.secondaryCategory,
      highlightedText: h.text,
    }));
  }

  /** Background push: a fresher view of this page for the active project. */
  function applyUpdate(msg) {
    if (!state.initialized) return;
    if (self.OpsEnabled && !self.OpsEnabled.get()) return;
    if (msg.normalizedUrl && msg.normalizedUrl !== normalizeUrl(opsPageUrl())) return;
    if (state.project && msg.projectId && msg.projectId !== state.project.projectId) return;
    applyPageView_(msg, true);
  }

  /**
   * The page changed URL without a reload (pushState / SPA navigation). The
   * saved work for the OLD URL is no longer this page's — clear it and load
   * the new URL's. Same reset as switching projects, minus the project change.
   */
  function resetForNewUrl() {
    state.pageHighlights.forEach((h) => { if (self.unwrapMark) self.unwrapMark(h.highlightId); });
    cleanupReanchorRetries_();
    if (_loadRetryTimer) { clearTimeout(_loadRetryTimer); _loadRetryTimer = null; }
    _loadAttempt = 0;
    state.pageHighlights = [];
    state.pageSource = null;
    state.filter = null;
    state.editingId = null;
    state.altPickerOpenId = null;
    state.sourceSaveStatus = null;
    state.loadingHighlights = true;
    render_();
    return loadForCurrentPage();
  }

  // Re-anchoring can run before late-rendered / hydrated / lazy-loaded body
  // text is in the DOM, so a first miss usually means "not ready yet", not
  // "page changed". Retry the still-unanchored set as the page settles — driven
  // by a debounced MutationObserver plus a few backstop timers — and clear the
  // per-entry "page changed" flag as marks land. Give up after a bounded window
  // so a genuinely changed page does eventually surface the flag. reAnchor is
  // idempotent (skips IDs already marked in the DOM), so re-passing the full
  // set only re-attempts the ones still missing.
  let _reanchorObserver = null;
  let _reanchorTimers = [];

  function scheduleReanchorRetries_(serverHighlights) {
    cleanupReanchorRetries_();            // reset any prior run (e.g. re-enable)
    runReanchorPass_(serverHighlights);   // initial attempt + flag misses
    if (!anyPendingReanchor_()) return;

    let queued = false;
    const retry = () => {
      runReanchorPass_(serverHighlights);
      if (!anyPendingReanchor_()) cleanupReanchorRetries_();
    };
    const kick = () => {                  // debounce a burst of mutations
      if (queued) return;
      queued = true;
      setTimeout(() => { queued = false; retry(); }, 250);
    };

    try {
      _reanchorObserver = new MutationObserver(kick);
      _reanchorObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    } catch (e) { /* no body yet — the timers below still cover it */ }

    // Backstop for content that settles without further mutations, and a hard
    // stop so the observer can't linger for the life of the tab.
    [600, 1500, 4000, 9000].forEach((ms) => _reanchorTimers.push(setTimeout(retry, ms)));
    _reanchorTimers.push(setTimeout(cleanupReanchorRetries_, 30000));
  }

  function runReanchorPass_(serverHighlights) {
    if (!self.reAnchorHighlights) return;
    const colorWithFallback = (label) => colorForLabel_(label) || '#fff8c4';
    const { failed } = self.reAnchorHighlights(serverHighlights, colorWithFallback);
    const failedSet = new Set(failed);
    let changed = false;
    state.pageHighlights.forEach((h) => {
      const missing = failedSet.has(h.highlightId);
      if (!!h.notFoundOnPage !== missing) { h.notFoundOnPage = missing; changed = true; }
    });
    // Marks are applied to the page regardless; only skip the sidebar re-render
    // (which would steal focus / cursor) while the student is editing a field.
    if (changed && !isEditingInPanel_()) render_();
  }

  function anyPendingReanchor_() {
    return state.pageHighlights.some((h) => h.notFoundOnPage);
  }

  function cleanupReanchorRetries_() {
    if (_reanchorObserver) { _reanchorObserver.disconnect(); _reanchorObserver = null; }
    _reanchorTimers.forEach((t) => clearTimeout(t));
    _reanchorTimers = [];
  }

  function isEditingInPanel_() {
    if (!state.shadowRoot) return false;
    const a = state.shadowRoot.activeElement;
    return !!a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || a.tagName === 'SELECT');
  }

  /**
   * Re-anchor cached page highlights inside the given DOM subtree. Called
   * by the PDF panel after each lazily-rendered page so saved highlights
   * appear the moment a student scrolls to the page. Idempotent — the
   * underlying reAnchorHighlights skips IDs that already have a mark span.
   */
  function reanchorIn(rootEl) {
    if (!rootEl) return { anchored: [], failed: [] };
    if (!self.reAnchorHighlights) return { anchored: [], failed: [] };
    if (state.pageHighlights.length === 0) return { anchored: [], failed: [] };
    const highlights = state.pageHighlights.map((h) => ({
      highlightId: h.highlightId,
      primaryCategory: h.primaryCategory,
      secondaryCategory: h.secondaryCategory,
      highlightedText: h.text,
    }));
    const colorWithFallback = (label) => colorForLabel_(label) || '#fff8c4';
    const result = self.reAnchorHighlights(highlights, colorWithFallback, rootEl);
    const anchoredSet = new Set(result.anchored || []);
    let changed = false;
    state.pageHighlights.forEach((h) => {
      if (anchoredSet.has(h.highlightId) && h.notFoundOnPage) {
        h.notFoundOnPage = false;
        changed = true;
      }
    });
    if (changed) render_();
    return result;
  }

  // "Highlights have been loaded from the server" promise. Resolves once
  // loadForCurrentPage finishes (success OR failure — the caller just needs
  // to know it's safe to call reanchorIn now).
  let _loadResolve = null;
  const _loadedPromise = new Promise((resolve) => { _loadResolve = resolve; });
  function whenLoaded() { return _loadedPromise; }
  const _origLoadForCurrentPage = loadForCurrentPage;
  loadForCurrentPage = async function () {
    try { await _origLoadForCurrentPage(); }
    finally { if (_loadResolve) { _loadResolve(); _loadResolve = null; } }
  };

  async function loadContext_() {
    try {
      const ctx = await chrome.runtime.sendMessage({ type: 'getActiveProject' });
      if (ctx && ctx.ok) {
        // Don't clobber a previously-resolved project with a transient null
        // (cold service worker / failed background refresh). Holding last-good
        // is what keeps the picker stable and lets the toolbar borrow it.
        if (ctx.project) {
          state.project = ctx.project;
          state.bundle = ctx.bundle;
        }
        if (ctx.projects && ctx.projects.length) state.projects = ctx.projects;
      }
    } catch (e) {
      // Orphaned tab after a reload/auto-update — surface the reload hint once
      // instead of spamming the console; saving can't work until reload anyway.
      if (opsIsContextInvalidated_(e)) { showReloadHint_(); return; }
      console.warn('[OPS sidebar] could not load active project:', e);
    }
  }

  // The sidebar's last-resolved context. Exposed so the selection toolbar can
  // borrow it when its own getActiveProject call comes back empty during a cold
  // start — the two surfaces then can't disagree about the active project.
  function getContext() {
    return { project: state.project, bundle: state.bundle, projects: state.projects };
  }

  // One-time banner shown when this page's content script has been orphaned by
  // an extension reload/auto-update. Lives in the shadow host (visible whether
  // the panel is open or collapsed) and only uses page APIs (location.reload),
  // so it works even though chrome.* is dead. Idempotent via reloadHintShown.
  function showReloadHint_() {
    if (state.reloadHintShown || !state.shadowRoot) return;
    state.reloadHintShown = true;
    const root = state.shadowRoot.querySelector('.root') || state.shadowRoot;
    const hint = el_('div', 'reload-hint');
    hint.appendChild(el_('div', null,
      'OPS Research Tool was updated. Reload this page to keep saving your highlights.'));
    const actions = el_('div', 'reload-hint__actions');
    const dismiss = el_('button', 'reload-hint__btn reload-hint__btn--dismiss', 'Dismiss');
    dismiss.type = 'button';
    dismiss.addEventListener('click', () => hint.remove());
    const reload = el_('button', 'reload-hint__btn reload-hint__btn--reload', 'Reload');
    reload.type = 'button';
    reload.addEventListener('click', () => location.reload());
    actions.appendChild(dismiss);
    actions.appendChild(reload);
    hint.appendChild(actions);
    root.appendChild(hint);
  }

  // Switch the active project from the sidebar's picker. Persists + server-syncs
  // through the service worker, then resets this page's state and reloads the
  // newly-selected project's saved work for the current URL.
  async function switchProject_(projectId) {
    if (!projectId || (state.project && state.project.projectId === projectId)) return;
    // Drop the previous project's on-page marks before we discard its highlights.
    state.pageHighlights.forEach((h) => { if (self.unwrapMark) self.unwrapMark(h.highlightId); });
    cleanupReanchorRetries_();
    state.pageHighlights = [];
    state.pageSource = null;
    state.filter = null;
    state.editingId = null;
    state.altPickerOpenId = null;
    state.sourceSaveStatus = null;
    // Skeleton the list right away so the switch doesn't flash an empty state
    // before loadForCurrentPage's fetch comes back with the new project's work.
    state.loadingHighlights = true;
    try {
      await chrome.runtime.sendMessage({ type: 'setActiveProject', projectId });
    } catch (e) {
      console.warn('[OPS sidebar] setActiveProject failed:', e);
    }
    await loadContext_();   // new project + bundle + refreshed projects list
    render_();
    loadForCurrentPage();   // fetch this page's work for the newly active project
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
    state.launcherEl.setAttribute('aria-label', 'Open OPS Research panel');
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

  // Feather-style pen glyph (static, no user input — safe to inline as markup).
  const LAUNCHER_PEN_SVG =
    '<svg class="launcher__icon" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 20h9"></path>' +
    '<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>' +
    '</svg>';

  function renderLauncher_() {
    const visibleCount = state.pageHighlights.length;
    const countHtml = visibleCount > 0
      ? '<span class="launcher__count">' + visibleCount + '</span>'
      : '';
    state.launcherEl.innerHTML = LAUNCHER_PEN_SVG + countHtml;
  }

  function renderPanel_() {
    state.panelEl.innerHTML = '';

    // Branded header — OPS wordmark + a right-arrow that collapses the panel
    // back into the edge launcher tab.
    const hdr = el_('div', 'panel__header');
    hdr.appendChild(el_('span', 'panel__brand', 'OPS Research Tool'));
    const collapse = el_('button', 'panel__collapse');
    collapse.type = 'button';
    collapse.textContent = '→'; // → collapse
    collapse.title = 'Collapse panel';
    collapse.setAttribute('aria-label', 'Collapse panel');
    collapse.addEventListener('click', () => hide());
    hdr.appendChild(collapse);
    state.panelEl.appendChild(hdr);

    // Project selector (the active project this page's work saves to).
    const projWrap = el_('div', 'panel__project');
    projWrap.appendChild(el_('span', 'panel__project-label', 'Project'));
    const projSel = document.createElement('select');
    projSel.className = 'panel__project-select';
    if (!state.projects || state.projects.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = state.project ? state.project.name : 'No projects available';
      projSel.appendChild(opt);
      projSel.disabled = true;
    } else {
      state.projects.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.projectId;
        opt.textContent = p.name + (p.schoolYear ? ' (' + p.schoolYear + ')' : '');
        if (state.project && p.projectId === state.project.projectId) opt.selected = true;
        projSel.appendChild(opt);
      });
      projSel.addEventListener('change', () => switchProject_(projSel.value));
    }
    projWrap.appendChild(projSel);
    state.panelEl.appendChild(projWrap);

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
    // While the first fetch is in flight with nothing loaded yet, suppress the
    // facets (their counts would all read 0) and skeleton the list instead.
    const loadingEmpty = state.loadingHighlights && state.pageHighlights.length === 0;
    if (state.bundle && !loadingEmpty) {
      state.panelEl.appendChild(renderFacetList_());
      // Same evidence-target nudge as the Source tab, under the facets. Computed
      // each render from pageHighlights; null (and so nothing) when no depth
      // requirement is set, so no-requirements projects are unchanged.
      const annHint = evidenceHint_(state.pageHighlights, state.project && state.project.requirements);
      if (annHint) state.panelEl.appendChild(el_('div', 'facet__hint', annHint));
    }

    // List
    state.listEl = el_('div', 'list');
    if (loadingEmpty) {
      for (let i = 0; i < 3; i++) state.listEl.appendChild(renderSkeletonEntry_());
    } else {
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
    }
    state.panelEl.appendChild(state.listEl);
  }

  // A single shimmering placeholder card matching the .entry footprint.
  function renderSkeletonEntry_() {
    const skel = el_('div', 'skel');
    skel.setAttribute('aria-hidden', 'true');
    skel.appendChild(el_('div', 'skel__bar'));
    skel.appendChild(el_('div', 'skel__line skel__line--cat'));
    skel.appendChild(el_('div', 'skel__line skel__line--full'));
    skel.appendChild(el_('div', 'skel__line skel__line--short'));
    return skel;
  }

  // Placeholder for the Source tab's citation form while the page's source loads.
  function renderSourceSkeleton_() {
    const wrap = el_('div', 'skel-src');
    wrap.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 5; i++) {
      const fld = el_('div', 'skel-src__fld');
      fld.appendChild(el_('div', 'skel__line skel__line--label'));
      fld.appendChild(el_('div', 'skel__line skel__line--input'));
      wrap.appendChild(fld);
    }
    const anno = el_('div', 'skel-src__fld');
    anno.appendChild(el_('div', 'skel__line skel__line--label'));
    anno.appendChild(el_('div', 'skel__line skel__line--ta'));
    wrap.appendChild(anno);
    return wrap;
  }

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

  // Effective field values: student-entered citationFields win (including
  // deliberate empties), then the rich scrape, then defaults. A key that is
  // present in citationFields — even as an empty string — is taken as-is so
  // that a student who clears a field is not overridden by a scraped value.
  // Mirrors source_editor_js.html renderCitationForm.
  function effectiveFields_(src) {
    const extra = src.scrapedExtra || {};
    const cf = src.citationFields || {};
    const pick = (key, fallback) => (key in cf ? cf[key] : (fallback || ''));
    const f = {};
    f.sourceType    = ('sourceType' in cf && cf.sourceType) ? cf.sourceType : (src.sourceType || extra.sourceType || 'website');
    f.title         = pick('title', src.scrapedTitle);
    f.siteName      = pick('siteName', src.scrapedSite);
    f.publishedDate = pick('publishedDate', src.scrapedDate);
    f.author        = pick('author', src.scrapedAuthor);
    f.publication   = pick('publication', extra.publication);
    f.publisher     = pick('publisher', extra.publisher);
    f.volume        = pick('volume', extra.volume);
    f.issue         = pick('issue', extra.issue);
    f.pages         = pick('pages', extra.pages);
    f.url           = pick('url', src.rawUrl);
    f.archive       = pick('archive', extra.archive);
    f.accessDate    = pick('accessDate', src.accessDate);
    return f;
  }

  function renderSourceTab_() {
    if (!state.pageSource) {
      // Same fetch window as the list: skeleton while loading, false-empty only
      // once the load has settled and there's genuinely no source yet.
      if (state.loadingHighlights) return renderSourceSkeleton_();
      return el_('div', 'src__empty', 'Highlight something on this page to start its citation.');
    }
    const src = state.pageSource;
    const fields = effectiveFields_(src);

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
      if (!src.citationFields) src.citationFields = {};
      src.citationFields.sourceType = sel.value;
      src.sourceType = sel.value;
      saveSource_();
      render_(); // re-render to swap the field set
    });
    typeWrap.appendChild(sel);
    form.appendChild(typeWrap);

    // Per-type fields
    sourceFieldsFor_(fields.sourceType).forEach((def) => {
      const wrap = el_('div', 'src__fld');
      wrap.appendChild(el_('label', null, def.label));
      const inp = document.createElement('input');
      inp.type = 'text'; inp.value = fields[def.key] || '';
      const commit = () => {
        if (!src.citationFields) src.citationFields = {};
        src.citationFields[def.key] = inp.value;
        saveSource_();
        schedulePreview_();
      };
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
      const b = el_('button', 'src__seg-btn' + ((src.primarySecondary || 'unset') === opt ? ' src__seg--on' : ''), opt[0].toUpperCase() + opt.slice(1));
      b.type = 'button';
      b.addEventListener('click', () => { src.primarySecondary = opt; saveSource_(); render_(); });
      seg.appendChild(b);
    });
    tagWrap.appendChild(seg);
    form.appendChild(tagWrap);

    // Per-source evidence-target nudge (computed each render from the live
    // pageHighlights, so it tracks add/remove/recategorize). Renders nothing
    // when the project sets no highlight/category depth requirement.
    const hintText = evidenceHint_(state.pageHighlights, state.project && state.project.requirements);
    if (hintText) form.appendChild(el_('div', 'src__hint', hintText));

    // Annotation — label flags required vs optional from the project requirement
    // (default: required; only "optional" when requireAnnotation is explicitly false).
    const annOptional = !!(state.project && state.project.requirements
      && state.project.requirements.requireAnnotation === false);
    const annWrap = el_('div', 'src__fld');
    annWrap.appendChild(el_('label', null, 'Annotation (' + (annOptional ? 'optional' : 'required') + ')'));
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
        .catch((err) => {
          state.sourceSaveStatus = 'error'; paintSourceStatus_();
          if (opsIsContextInvalidated_(err)) showReloadHint_();
        });
    }, 500);
  }
  function paintSourceStatus_() {
    const el = state.shadowRoot && state.shadowRoot.querySelector('.src__status');
    if (!el) return;
    el.className = 'src__status' + (state.sourceSaveStatus ? ' src__status--' + state.sourceSaveStatus : '');
    el.textContent = { pending: 'saving…', saved: '✓ saved', error: '⚠ save failed' }[state.sourceSaveStatus] || '';
  }

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

    // Two-step Delete: first click → "Confirm?" (red filled), second click
    // within 3s → actually deletes. Click anywhere else cancels.
    const del = el_('button', 'entry__delete-toggle');
    del.type = 'button';
    const confirming = state.confirmingDeleteId === h.highlightId;
    del.textContent = confirming ? 'Confirm?' : 'Delete';
    if (confirming) del.classList.add('entry__delete-toggle--confirming');
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirming) {
        deleteHighlight_(h);
      } else {
        if (state.confirmingDeleteTimer) clearTimeout(state.confirmingDeleteTimer);
        state.confirmingDeleteId = h.highlightId;
        state.confirmingDeleteTimer = setTimeout(() => {
          if (state.confirmingDeleteId === h.highlightId) {
            state.confirmingDeleteId = null;
            state.confirmingDeleteTimer = null;
            render_();
          }
        }, 3000);
        render_();
      }
    });
    right.appendChild(del);

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
      if (opsIsContextInvalidated_(e)) showReloadHint_();
      else console.warn('[OPS sidebar] delete failed:', e);
    }

    if (wasLastForSource) showOrphanToast_(h.sourceId);
  }

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

  // Pure: given this source's highlights + the project's requirements, return a
  // short nudge string (or null when no evidence-depth requirement is set, so
  // nothing renders for no-requirements projects). Distinct categories count
  // distinct non-empty PRIMARY categories only — secondary tags never count.
  function evidenceHint_(highlightsForSource, req) {
    if (!req || (!req.minHighlightsPerSource && !req.minDistinctCategories)) return null;
    const count = highlightsForSource.length;
    const cats = {};
    highlightsForSource.forEach((h) => { if (h.primaryCategory) cats[h.primaryCategory] = true; });
    const distinct = Object.keys(cats).length;
    const needH = req.minHighlightsPerSource ? Math.max(0, req.minHighlightsPerSource - count) : 0;
    const needC = req.minDistinctCategories ? Math.max(0, req.minDistinctCategories - distinct) : 0;
    if (needH === 0 && needC === 0) return 'Meets this project’s evidence target ✓';
    const parts = [];
    if (needH > 0) parts.push(needH + ' more highlight' + (needH > 1 ? 's' : ''));
    if (needC > 0) parts.push(needC + ' more categor' + (needC > 1 ? 'ies' : 'y'));
    return 'Needs ' + parts.join(' and ');
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
    }).then(() => markSynced(h.highlightId)).catch((e) => {
      markError(h.highlightId, e.message);
      if (opsIsContextInvalidated_(e)) showReloadHint_();
    });
  }

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
  function _setSourceId(highlightId, sourceId, scrape) {
    const h = state.pageHighlights.find((x) => x.highlightId === highlightId);
    if (h) h.sourceId = sourceId;
    if (!state.pageSource && sourceId) {
      const sc = scrape || {};
      state.pageSource = {
        sourceId,
        projectId: state.project ? state.project.projectId : '',
        normalizedUrl: '',
        rawUrl: opsPageUrl(),
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

  return { addHighlight, markSynced, markError, focus, show, hide, toggle, _setSourceId, loadForCurrentPage, reanchorIn, whenLoaded, getContext, showReloadHint: showReloadHint_, applyUpdate, resetForNewUrl };
})();

self.OpsSidebar = OpsSidebar;

// Background pushes: after serving a cached snapshot the service worker
// refreshes from the server and sends the fresher page view here.
try {
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'pageHighlightsUpdated') return;
    try { OpsSidebar.applyUpdate(msg); } catch (e) { console.warn('[OPS sidebar] applyUpdate failed:', e); }
  });
} catch (e) { /* orphaned context — reload hint covers it */ }

// Single-page-app navigation: many news / database sites change the URL via
// pushState without a reload, so the content script never re-runs and the
// sidebar kept showing the PREVIOUS article's highlights (and never loaded the
// new one's). Watch the normalized URL and reload the page view on change.
// Fragments are ignored by normalizeUrl, so #anchors don't churn. The PDF
// panel pins its URL via OPS_PAGE_URL and is exempt.
(function watchUrlChanges_() {
  if (self.OPS_PAGE_URL) return;
  let last = normalizeUrl(location.href);
  const check = () => {
    let now;
    try { now = normalizeUrl(location.href); } catch (e) { return; }
    if (now === last) return;
    last = now;
    OpsSidebar.resetForNewUrl().catch(() => {});
  };
  window.addEventListener('popstate', check);
  window.addEventListener('hashchange', check);
  setInterval(check, 1500);
})();

// Kick a server load on every page load so the sidebar reflects saved work
// even after the page reloads. Fires once per content script instance. Best-
// effort — retries with backoff if offline / the backend is cold, and shows
// not-yet-synced local work meanwhile.
OpsSidebar.loadForCurrentPage();
