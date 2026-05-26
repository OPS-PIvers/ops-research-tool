/**
 * PDF Tier 2 panel (build plan §2, PDF handling).
 *
 * Loaded as an ES module so it can import PDF.js's modern build. Flow:
 *
 *   1. Read ?src=<pdf url> from the panel URL.
 *   2. Fetch the PDF bytes (via background to avoid CORS pitfalls).
 *   3. PDF.js getDocument → loop pages → getTextContent → render text.
 *   4. If no pages produced text, show the scanned-PDF empty state and
 *      offer a Tier 1 "save as source" path (citation-only, no highlights).
 *   5. Once text is rendered, the existing toolbar/marks/scrape content
 *      scripts (loaded as plain scripts by panel.html) handle highlighting
 *      exactly as on a normal web page.
 */

import * as pdfjsLib from '../vendor/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdf.worker.min.mjs');

const els = {
  title: document.getElementById('title'),
  openOriginal: document.getElementById('open-original'),
  saveSource: document.getElementById('save-source'),
  loading: document.getElementById('loading'),
  empty: document.getElementById('empty'),
  error: document.getElementById('error'),
  text: document.getElementById('text'),
};

const params = new URLSearchParams(location.search);
const pdfUrl = params.get('src');

if (!pdfUrl) {
  showError('No PDF URL given (missing ?src= parameter).');
} else {
  // Override location-based scraping: the toolbar reads `location.href`
  // and `document.title` to identify the page. We want it to identify
  // the PDF, not chrome-extension://.../panel.html. The simplest fix:
  // patch the helpers that the toolbar/scrape call so they return the
  // real PDF URL + filename.
  installSourceUrlShim_(pdfUrl);
  els.openOriginal.href = pdfUrl;
  els.title.textContent = filenameFromUrl_(pdfUrl);
  document.title = 'OPS Research Tool — ' + els.title.textContent;
  loadAndRender(pdfUrl);
}

async function loadAndRender(url) {
  try {
    const bytes = await fetchPdfBytes(url);
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const paragraphs = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageParas = textContentToParagraphs_(content);
      if (pageParas.length === 0) continue;
      paragraphs.push({ pageNum: i, paras: pageParas });
    }
    renderText_(paragraphs);
    if (paragraphs.length === 0) {
      els.loading.hidden = true;
      els.empty.hidden = false;
      els.saveSource.disabled = false;
    } else {
      els.loading.hidden = true;
      els.text.hidden = false;
      els.saveSource.disabled = false;
    }
  } catch (e) {
    showError('Could not read this PDF: ' + (e && e.message || e));
  }
}

/**
 * PDF.js getTextContent returns items with `.str` and `.hasEOL`. Items often
 * lack spaces between words (the PDF layer is character-positioned). Use
 * hasEOL to break lines, and group blank-line-separated lines into paragraphs.
 */
function textContentToParagraphs_(content) {
  const lines = [];
  let buf = '';
  for (const item of content.items) {
    if (item.str !== undefined) buf += item.str;
    if (item.hasEOL) {
      lines.push(buf.trim());
      buf = '';
    } else if (item.str && !item.str.endsWith(' ')) {
      // PDF.js doesn't always emit hasEOL between adjacent items; add a
      // soft space so words don't run together.
      if (!buf.endsWith(' ')) buf += ' ';
    }
  }
  if (buf.trim()) lines.push(buf.trim());

  // Group lines into paragraphs separated by blank lines.
  const paras = [];
  let cur = [];
  for (const ln of lines) {
    if (!ln) {
      if (cur.length) paras.push(cur.join(' '));
      cur = [];
    } else {
      cur.push(ln);
    }
  }
  if (cur.length) paras.push(cur.join(' '));
  return paras.filter((p) => p.length > 0);
}

function renderText_(pageGroups) {
  els.text.innerHTML = '';
  pageGroups.forEach((g, idx) => {
    if (idx > 0) {
      const br = document.createElement('div');
      br.className = 'page-break';
      br.textContent = 'Page ' + g.pageNum;
      els.text.appendChild(br);
    }
    g.paras.forEach((para) => {
      const p = document.createElement('p');
      p.textContent = para;
      els.text.appendChild(p);
    });
  });
}

async function fetchPdfBytes(url) {
  // Route through the background so we get the extension's host_permissions
  // (avoids CORS surprises on cross-origin PDFs).
  const resp = await chrome.runtime.sendMessage({ type: 'fetchPdf', url });
  if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'fetch failed');
  // Decode base64 -> Uint8Array
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

/**
 * The toolbar's scrape + URL resolution looks at `location.href` and
 * `document.title`. Inside the panel those would identify the panel HTML,
 * not the PDF. Patch the global `scrapePageMeta` and seed a getter that
 * the toolbar uses to construct the source URL.
 */
function installSourceUrlShim_(realUrl) {
  // toolbar.js calls scrapePageMeta() defined in scrape.js (global on self).
  const originalScrape = self.scrapePageMeta;
  self.scrapePageMeta = function () {
    const base = originalScrape ? originalScrape() : {};
    return {
      title: filenameFromUrl_(realUrl),
      site: hostnameOf_(realUrl),
      date: base.date || '',
      author: base.author || '',
    };
  };
  // toolbar.js reads location.href directly when sending getOrCreateSourceId.
  // Easiest patch: define a getter on the URL panel.js can intercept… but
  // simplest is to override location with a proxy. Instead: monkey-patch
  // location.href getter via Object.defineProperty — not possible. Fallback:
  // patch chrome.runtime.sendMessage to swap the rawUrl on getOrCreateSourceId.
  const sendOrig = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = function (msg, cb) {
    if (msg && msg.type === 'getOrCreateSourceId') {
      msg = Object.assign({}, msg, { rawUrl: realUrl });
    }
    return sendOrig(msg, cb);
  };
}

function hostnameOf_(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch (e) { return ''; }
}
