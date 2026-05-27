/**
 * PDF Tier 2 panel (build plan §2, PDF handling) — full-fidelity rendering.
 *
 * Each PDF page is rendered as a <canvas> with a transparent <div class="textLayer">
 * overlaid on top. The text-layer spans carry the real text (positioned to
 * match the rendered glyphs underneath); selection + the existing
 * toolbar/marks content scripts work against them exactly like any DOM.
 * Highlights paint background-color through the transparent text spans, so
 * the user sees a colored block over the canvas-rendered words — same UX
 * as a normal PDF viewer.
 *
 * Pages render lazily via IntersectionObserver so opening a 40-page PDF
 * doesn't blow up memory. Each page placeholder is sized from page 1's
 * dimensions (assuming uniform page size — true for ~99% of real PDFs).
 *
 * Scanned-PDF fallback: if NO page yields any text content, we surface the
 * "scanned PDF — save manually" empty state and the Tier 1 source button.
 */

import * as pdfjsLib from '../vendor/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdf.worker.min.mjs');

// Target visual width in CSS pixels. The viewport scale is computed from
// each page's unscaled width so the rendered canvas is pixel-perfect at
// this size — no CSS scaling, so text-layer alignment is trivial.
const TARGET_WIDTH_PX = 820;

const els = {
  title: document.getElementById('title'),
  openOriginal: document.getElementById('open-original'),
  saveSource: document.getElementById('save-source'),
  loading: document.getElementById('loading'),
  empty: document.getElementById('empty'),
  error: document.getElementById('error'),
  pages: document.getElementById('pages'),
};

const params = new URLSearchParams(location.search);
const pdfUrl = params.get('src');

if (!pdfUrl) {
  showError('No PDF URL given (missing ?src= parameter).');
} else {
  // URL-rewrite shim (chrome.runtime.sendMessage + scrapePageMeta) is
  // installed by an inline <script> in panel.html — it has to run BEFORE
  // sidebar.js fires its initial loadForCurrentPage(), which is earlier
  // than this ES module can execute. See panel.html for the shim body.
  els.openOriginal.href = pdfUrl;
  els.title.textContent = filenameFromUrl_(pdfUrl);
  document.title = 'OPS Research Tool — ' + els.title.textContent;
  loadAndRender(pdfUrl);
}

let pdfDoc = null;
let renderObserver = null;
// Track whether ANY page produced text — if all pages are empty, this is a
// scanned PDF and we surface the empty state at the end.
let anyTextSeen = false;
let pagesAttempted = 0;

async function loadAndRender(url) {
  try {
    const bytes = await fetchPdfBytes(url);
    pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;

    // Use page 1's viewport to size all placeholders. Most PDFs have
    // uniform page size; the rare exception will look slightly off until
    // its real render replaces the placeholder.
    const firstPage = await pdfDoc.getPage(1);
    const unscaled = firstPage.getViewport({ scale: 1 });
    const scale = TARGET_WIDTH_PX / unscaled.width;
    const placeholderHeight = Math.round(unscaled.height * scale);
    const placeholderWidth = Math.round(unscaled.width * scale);

    els.loading.hidden = true;
    els.pages.hidden = false;
    els.saveSource.disabled = false;

    renderObserver = new IntersectionObserver(onPageVisible_, {
      root: null,
      rootMargin: '400px 0px', // pre-render slightly above/below the fold
      threshold: 0,
    });

    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const ph = document.createElement('div');
      ph.className = 'page page--placeholder';
      ph.dataset.pageNum = String(i);
      ph.style.width = placeholderWidth + 'px';
      ph.style.height = placeholderHeight + 'px';
      const spinner = document.createElement('div');
      spinner.className = 'page__spinner';
      spinner.textContent = 'Page ' + i;
      ph.appendChild(spinner);
      els.pages.appendChild(ph);
      renderObserver.observe(ph);
    }
  } catch (e) {
    showError('Could not read this PDF: ' + (e && e.message || e));
  }
}

function onPageVisible_(entries) {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const target = entry.target;
    if (target.dataset.rendered === 'true') continue;
    if (target.dataset.rendering === 'true') continue;
    target.dataset.rendering = 'true';
    const pageNum = parseInt(target.dataset.pageNum, 10);
    renderPage_(pageNum, target).catch((e) => {
      console.warn('[OPS] page', pageNum, 'failed:', e);
      target.dataset.rendering = '';
    });
  }
}

async function renderPage_(pageNum, container) {
  const page = await pdfDoc.getPage(pageNum);
  const unscaled = page.getViewport({ scale: 1 });
  const scale = TARGET_WIDTH_PX / unscaled.width;
  const viewport = page.getViewport({ scale });

  // Build canvas + text layer.
  const canvas = document.createElement('canvas');
  canvas.className = 'page__canvas';
  // devicePixelRatio backing so retina/HiDPI doesn't look fuzzy. Capped at
  // 1.5 because a 40-page PDF at full retina (dpr=2) holds ~14MB per
  // canvas → ~550MB resident. 1.5 cuts that in half and is visually
  // indistinguishable for body text.
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = Math.floor(viewport.width) + 'px';
  canvas.style.height = Math.floor(viewport.height) + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const textLayerDiv = document.createElement('div');
  textLayerDiv.className = 'textLayer';
  textLayerDiv.style.setProperty('--scale-factor', String(viewport.scale));
  textLayerDiv.style.width = Math.floor(viewport.width) + 'px';
  textLayerDiv.style.height = Math.floor(viewport.height) + 'px';

  // Replace placeholder content with the real page nodes BEFORE rendering
  // so users see the canvas progressively (PDF.js render is async and
  // paints in chunks).
  container.innerHTML = '';
  container.classList.remove('page--placeholder');
  container.classList.add('page--rendered');
  container.style.width = Math.floor(viewport.width) + 'px';
  container.style.height = Math.floor(viewport.height) + 'px';
  container.appendChild(canvas);
  container.appendChild(textLayerDiv);

  // Render the canvas.
  await page.render({ canvasContext: ctx, viewport }).promise;

  // Render the text layer. pdfjsLib.TextLayer is the v4+ API; the older
  // renderTextLayer function was removed. If a future PDF.js upgrade
  // changes this, we fall back to no text layer (page is still visible,
  // just not selectable on that page).
  try {
    const textContent = await page.getTextContent();
    const hasText = (textContent.items || []).some((it) => it.str && it.str.trim());
    if (hasText) anyTextSeen = true;
    if (typeof pdfjsLib.TextLayer === 'function') {
      const layer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport,
      });
      await layer.render();
    } else {
      console.warn('[OPS] pdfjsLib.TextLayer not available; selection disabled on this page.');
    }
  } catch (e) {
    console.warn('[OPS] text layer failed for page', pageNum, ':', e);
  }

  container.dataset.rendered = 'true';
  container.dataset.rendering = '';
  pagesAttempted++;
  maybeShowScannedFallback_();

  // Overlay any server-saved highlights that match text on this page. Safe
  // to call even before sidebar.js finishes loading from the server — it'll
  // no-op if the cache is empty, and we run a second sweep below once the
  // load promise resolves.
  if (self.OpsSidebar && self.OpsSidebar.reanchorIn) {
    self.OpsSidebar.reanchorIn(container);
  }
}

// Once the sidebar finishes its initial server load, sweep any pages that
// were already rendered before highlights arrived. Idempotent — pages with
// marks already anchored are skipped inside reAnchorHighlights.
if (self.OpsSidebar && self.OpsSidebar.whenLoaded) {
  self.OpsSidebar.whenLoaded().then(() => {
    document.querySelectorAll('.page--rendered').forEach((p) => {
      self.OpsSidebar.reanchorIn(p);
    });
  });
}

function maybeShowScannedFallback_() {
  // If we've attempted at least 3 pages (or all of them, whichever is fewer)
  // and none produced text, surface the scanned-PDF empty state. We keep
  // the rendered canvases visible — the user can still see the images.
  const threshold = Math.min(3, pdfDoc ? pdfDoc.numPages : 1);
  if (anyTextSeen) return;
  if (pagesAttempted < threshold) return;
  if (!els.empty.hidden) return;
  els.empty.hidden = false;
}

async function fetchPdfBytes(url) {
  // Route through the background so we get the extension's host_permissions
  // (avoids CORS surprises on cross-origin PDFs).
  const resp = await chrome.runtime.sendMessage({ type: 'fetchPdf', url });
  if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'fetch failed');
  const bin = atob(resp.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function showError(msg) {
  els.loading.hidden = true;
  els.error.hidden = false;
  els.error.textContent = msg;
}

function filenameFromUrl_(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() || u.hostname;
    return decodeURIComponent(last);
  } catch (e) {
    return url;
  }
}

/**
 * Tier 1 fallback: user clicks "Save as source" — creates a source row with
 * the PDF URL + scraped filename, no highlights. They'll complete the
 * citation in the Docs sidebar in Phase 3.
 */
els.saveSource.addEventListener('click', async () => {
  els.saveSource.disabled = true;
  els.saveSource.textContent = 'Saving…';
  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'getOrCreateSourceId',
      rawUrl: pdfUrl,
      scrape: { title: filenameFromUrl_(pdfUrl), site: '', date: '', author: '' },
    });
    if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'save failed');
    els.saveSource.textContent = 'Saved';
  } catch (e) {
    els.saveSource.textContent = 'Save failed';
    showError(String(e && e.message || e));
  }
});

