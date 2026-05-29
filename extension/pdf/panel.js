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

    // Page 1 does double duty: sizes the placeholders (below) AND feeds the
    // citation-metadata extraction.
    const firstPage = await pdfDoc.getPage(1);

    // Extract the PDF's embedded document metadata (Info dictionary + XMP).
    // This is the only MACHINE-READABLE citation channel a PDF has — there
    // are no HTML <meta>/JSON-LD tags here for scrape.js to read. Best-effort:
    // many PDFs embed nothing and some embed junk, so it only pre-fills empty
    // fields and the student still verifies. Stashed on a global so the
    // panel shim's scrapePageMeta() override can merge it (see shim.js).
    window.OPS_PDF_META = await extractPdfMeta_(pdfDoc);

    // Second channel: conservative heuristics over page-1 BODY text (the
    // printed author block + a dated line), filling only fields the embedded
    // metadata left blank. Hard-gated on a clearly-detected title; returns
    // blank rather than guess when ambiguous. See extractPdfBodyHints_.
    try {
      const hints = await extractPdfBodyHints_(firstPage);
      const m = window.OPS_PDF_META;
      if (hints.author && !m.author) m.author = hints.author;
      if (hints.date && !m.date) m.date = hints.date;
    } catch (e) {
      console.warn('[OPS] page-1 body-hint extraction failed:', e);
    }

    // Use page 1's viewport to size all placeholders. Most PDFs have
    // uniform page size; the rare exception will look slightly off until
    // its real render replaces the placeholder.
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

/**
 * Read the PDF's embedded metadata via PDF.js getMetadata(). Returns the
 * three citation fields the form pre-fills: { title, author, date }. Pulls
 * from the Info dictionary first (Title/Author/CreationDate), falling back to
 * the XMP packet (dc:title / dc:creator / xmp:CreateDate). Fully defensive —
 * any failure yields empty fields, never throws.
 */
async function extractPdfMeta_(doc) {
  const out = { title: '', author: '', date: '' };
  let md;
  try {
    md = await doc.getMetadata();
  } catch (e) {
    return out;
  }
  const info = (md && md.info) || {};
  out.title = strTrim_(info.Title);
  out.author = strTrim_(info.Author);
  out.date = pdfDateToReadable_(info.CreationDate || info.ModDate);

  // XMP fallback for anything the Info dict left blank. Metadata.get() may
  // return a string or an array of {name|value} depending on the field.
  const xmp = md && md.metadata;
  if (xmp && typeof xmp.get === 'function') {
    if (!out.title) out.title = xmpStr_(xmp.get('dc:title'));
    if (!out.author) out.author = xmpStr_(xmp.get('dc:creator'));
    if (!out.date) out.date = pdfDateToReadable_(xmp.get('xmp:CreateDate') || xmp.get('xap:CreateDate'));
  }
  return out;
}

function strTrim_(v) {
  return (v && String(v).trim()) || '';
}

// XMP values come back as a string, an array of strings, or an array of
// objects — collapse to the first non-empty string.
function xmpStr_(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const s = xmpStr_(v[i]);
      if (s) return s;
    }
    return '';
  }
  if (typeof v === 'object') return strTrim_(v.value || v.name);
  return String(v).trim();
}

// PDF dates look like "D:20250513120000+00'00'" (Info dict) or ISO-8601
// "2025-05-13T12:00:00Z" (XMP). Reduce either to YYYY-MM-DD / YYYY-MM / YYYY —
// the student verifies and the MLA formatter is tolerant of partial dates.
function pdfDateToReadable_(d) {
  if (!d) return '';
  const s = String(d).trim();
  let m = s.match(/^D:(\d{4})(\d{2})?(\d{2})?/);
  if (!m) m = s.match(/^(\d{4})-?(\d{2})?-?(\d{2})?/);
  if (!m) return '';
  const parts = [m[1], m[2], m[3]].filter(Boolean);
  return parts.join('-');
}

/**
 * Conservative page-1 body-text heuristics (path #2). Returns { author, date }
 * pulled from the PRINTED text of page 1 — the channel a human reads but no
 * metadata exposes. Designed to return BLANK rather than guess when anything
 * is ambiguous: a wrong pre-filled author is worse than an empty field because
 * a student will trust it. The student verifies everything regardless.
 *
 * Strategy: group text items into lines (carrying font size), find the title
 * as the largest-font line group, then look just below it for an author block,
 * and scan the whole page for a publication-ish date.
 */
async function extractPdfBodyHints_(page) {
  const out = { author: '', date: '' };
  let tc;
  try {
    tc = await page.getTextContent();
  } catch (e) {
    return out;
  }
  const items = (tc.items || []).filter((it) => it.str && it.str.trim());
  if (!items.length) return out;

  const lines = groupLines_(items);
  if (!lines.length) return out;

  out.date = findPublicationDate_(lines);
  out.author = findAuthorConservative_(lines);
  return out;
}

// Group text items into visual lines, top-to-bottom. PDF y (transform[5])
// grows upward, so we sort descending. Items within ~3 units of y are one
// line; line `size` is the max glyph height (font size) in it.
function groupLines_(items) {
  const sorted = items.slice().sort((a, b) => {
    const dy = b.transform[5] - a.transform[5];
    if (Math.abs(dy) > 3) return dy;
    return a.transform[4] - b.transform[4]; // same line → left-to-right
  });
  const lines = [];
  let cur = null;
  for (const it of sorted) {
    const y = it.transform[5];
    const size = it.height || Math.abs(it.transform[3]) || 0;
    if (cur && Math.abs(cur.y - y) <= 3) {
      cur.text += it.str;
      if (size > cur.size) cur.size = size;
    } else {
      if (cur) lines.push(finalizeLine_(cur));
      cur = { y: y, size: size, text: it.str };
    }
  }
  if (cur) lines.push(finalizeLine_(cur));
  return lines;
}

function finalizeLine_(l) {
  l.text = l.text.replace(/\s+/g, ' ').trim();
  return l;
}

function medianSize_(lines) {
  const sizes = lines.map((l) => l.size).filter((s) => s > 0).sort((a, b) => a - b);
  if (!sizes.length) return 0;
  return sizes[Math.floor(sizes.length / 2)];
}

const MONTHS_ = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)';
const MONTH_NUM_ = {
  january: '01', jan: '01', february: '02', feb: '02', march: '03', mar: '03',
  april: '04', apr: '04', may: '05', june: '06', jun: '06', july: '07', jul: '07',
  august: '08', aug: '08', september: '09', sep: '09', sept: '09', october: '10',
  oct: '10', november: '11', nov: '11', december: '12', dec: '12',
};

// Scan page-1 lines for a publication date. Priority: a line whose keyword says
// it's a publication/accepted date, then a standalone copyright year, then any
// full date not on a "received" line, then a received date. Normalizes to
// YYYY-MM-DD / YYYY-MM / YYYY. Returns '' if nothing parses.
function findPublicationDate_(lines) {
  let copyrightYear = '';
  let acceptedDate = '';
  let receivedDate = '';
  let publishedDate = '';
  let looseDate = '';

  for (const l of lines) {
    const t = l.text;
    const lower = t.toLowerCase();
    const d = firstDateIn_(t);

    if (/copyright|©|\(c\)/i.test(t)) {
      const y = t.match(/\b(19|20)\d{2}\b/);
      if (y && !copyrightYear) copyrightYear = y[0];
    }
    if (!d) continue;
    if (/publish|publication|posted/.test(lower)) { if (!publishedDate) publishedDate = d; }
    else if (/accept/.test(lower)) { if (!acceptedDate) acceptedDate = d; }
    else if (/receiv|submit/.test(lower)) { if (!receivedDate) receivedDate = d; }
    else if (!looseDate) { looseDate = d; }
  }
  // Copyright year is the most reliable publication-year signal and sidesteps
  // the "Received … Accepted …" ambiguity (one line, two dates) where we can
  // only grab the first date. Explicit "Published" still wins if present.
  return publishedDate || copyrightYear || acceptedDate || looseDate || receivedDate || '';
}

// Find the first parseable date in a string and normalize it.
function firstDateIn_(t) {
  let m;
  // ISO: 2025-05-13
  m = t.match(/\b(19|20)\d{2}-(\d{2})-(\d{2})\b/);
  if (m) return m[0];
  // 13 May 2025  /  13 May, 2025
  m = t.match(new RegExp('\\b(\\d{1,2})\\s+' + MONTHS_ + ',?\\s+((?:19|20)\\d{2})\\b', 'i'));
  if (m) return isoFrom_(m[3], m[2], m[1]);
  // May 13, 2025  /  May 2025
  m = t.match(new RegExp('\\b' + MONTHS_ + '\\.?\\s+(\\d{1,2}),?\\s+((?:19|20)\\d{2})\\b', 'i'));
  if (m) return isoFrom_(m[3], m[1], m[2]);
  m = t.match(new RegExp('\\b' + MONTHS_ + '\\.?\\s+((?:19|20)\\d{2})\\b', 'i'));
  if (m) return isoFrom_(m[2], m[1], '');
  return '';
}

function isoFrom_(year, monthName, day) {
  const mo = MONTH_NUM_[String(monthName).toLowerCase().replace(/\./g, '')] || '';
  const parts = [year];
  if (mo) parts.push(mo);
  if (mo && day) parts.push(String(day).padStart(2, '0'));
  return parts.join('-');
}

// Publishing/structural words that disqualify a line from being an author block.
const AUTHOR_STOPWORDS_ = /(\bdepart|universit|\bfacult|\bcollege|\bschool\b|institut|\bdivision\b|\bcentre\b|\bcenter\b|received|accepted|submit|abstract|keyword|\bdoi\b|issn|isbn|copyright|©|\bvol\b|volume|\bissue\b|\bpages?\b|\bpp\b|\bpress\b|research paper|full length|full-length|original article|review article|correspond|author\(s\)|e-?mail|\bhttp|@|\.com|\.org|\.edu)/i;

// Locate the author block: the line(s) directly below the title. Hard gates:
//  - a clear title must exist (largest-font line ≥ 1.25× median body size)
//  - candidate lines must look like real names (mostly Title-Case tokens, no
//    digits/affiliation/email/publishing keywords)
// Merges consecutive qualifying lines (author lists often wrap), strips a
// trailing "and"/"&". Returns '' the moment confidence drops.
function findAuthorConservative_(lines) {
  const median = medianSize_(lines);
  if (!median) return '';

  // Title = the largest-font line. Require it to clearly stand above body text.
  let titleIdx = 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].size > lines[titleIdx].size) titleIdx = i;
  }
  const titleSize = lines[titleIdx].size;
  if (titleSize < median * 1.25) return '';

  // Title may span several lines at ~the same size — skip the whole group.
  let afterTitle = titleIdx + 1;
  while (afterTitle < lines.length && lines[afterTitle].size >= titleSize * 0.85) {
    afterTitle++;
  }

  // Collect consecutive name-shaped lines just below the title (cap at 3).
  const names = [];
  for (let i = afterTitle; i < lines.length && names.length < 3; i++) {
    const text = lines[i].text;
    if (!text) continue;
    if (!looksLikeNames_(text)) break;
    names.push(text);
  }
  if (!names.length) return '';

  let author = names.join(' ').replace(/\s+/g, ' ').trim();
  author = author.replace(/\s*(,|&|\band\b)\s*$/i, '').trim();
  return author;
}

// True only for lines that plausibly are a list of personal names: no digits,
// no affiliation/email/publishing keywords, and ≥70% of tokens are Title-Case
// name tokens (connectors like "and"/"&"/"," don't count against it).
function looksLikeNames_(text) {
  if (text.length < 4 || text.length > 160) return false;
  if (/\d/.test(text)) return false;
  if (AUTHOR_STOPWORDS_.test(text)) return false;

  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;
  let nameTokens = 0;
  let connectors = 0;
  for (let tok of tokens) {
    const bare = tok.replace(/[.,;&]/g, '');
    if (!bare) { connectors++; continue; }
    if (/^(and|y|et|und|&)$/i.test(bare)) { connectors++; continue; }
    if (/^[A-Z][A-Za-z'’.\-]*$/.test(bare)) { nameTokens++; continue; }
    // a lowercase/odd token (e.g. "critical", "analysis") — counts against.
  }
  const judged = tokens.length - connectors;
  if (judged < 2) return false;
  return nameTokens / judged >= 0.7;
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
    const pdfMeta = window.OPS_PDF_META || {};
    const resp = await chrome.runtime.sendMessage({
      type: 'getOrCreateSourceId',
      rawUrl: pdfUrl,
      scrape: {
        title: filenameFromUrl_(pdfUrl),
        site: '',
        date: pdfMeta.date || '',
        author: pdfMeta.author || '',
      },
    });
    if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'save failed');
    els.saveSource.textContent = 'Saved';
  } catch (e) {
    els.saveSource.textContent = 'Save failed';
    showError(String(e && e.message || e));
  }
});

