/**
 * Panel shim — loads before sidebar.js so its auto-fired initial
 * loadForCurrentPage() works correctly inside the PDF panel.
 *
 * Two responsibilities:
 *
 * 1) Set window.OPS_DEFER_REANCHOR = true. The panel renders pages lazily,
 *    so sidebar.js's default "walk document.body and re-anchor everything"
 *    pass on first load would find no text and falsely mark every saved
 *    highlight as "page changed." Panel.js triggers OpsSidebar.reanchorIn()
 *    per page instead.
 *
 * 2) Rewrite outgoing chrome.runtime.sendMessage payloads that pass
 *    location.href as rawUrl: location.href in this context is the
 *    chrome-extension://...panel.html?src=<pdf> URL, not the PDF itself.
 *    Background-side normalization needs the real PDF URL so saved
 *    highlights match the source row created on the previous session.
 *    Also override scrapePageMeta() for the same reason.
 *
 * This file MUST be a classic <script src=> (not inline — CSP blocks
 * inline; not type=module — modules defer until after sidebar.js fires).
 * It MUST be referenced AFTER scrape.js (so origScrape can shadow the
 * scrape.js global) and BEFORE sidebar.js (so the shim is in place when
 * sidebar.js auto-fires loadForCurrentPage at the bottom of its IIFE).
 */

(function () {
  window.OPS_DEFER_REANCHOR = true;

  var params = new URLSearchParams(location.search);
  var realUrl = params.get('src');
  if (!realUrl) return;

  var REWRITE = { getOrCreateSourceId: 1, loadPageHighlights: 1 };
  var sendOrig = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = function (msg, cb) {
    if (msg && REWRITE[msg.type]) {
      msg = Object.assign({}, msg, { rawUrl: realUrl });
    }
    return sendOrig(msg, cb);
  };

  // scrapePageMeta is defined by scrape.js (loaded earlier). Wrap it so
  // toolbar.js's syncHighlight_ stamps the new source row with the PDF's
  // filename + host, not "panel.html" / chrome-extension://...
  var origScrape = self.scrapePageMeta;
  self.scrapePageMeta = function () {
    var base = origScrape ? origScrape() : {};
    var name;
    try {
      var u = new URL(realUrl);
      name = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname);
    } catch (e) { name = realUrl; }
    var host;
    try { host = new URL(realUrl).hostname.replace(/^www\./, ''); }
    catch (e) { host = ''; }
    // Keep any richer fields the base scrape found; only the title + site need
    // to reflect the real PDF (not the panel.html wrapper URL).
    var out = Object.assign({}, base, { title: name, site: host });
    // Merge the PDF's embedded document metadata (set by panel.js once the
    // doc loads). PDFs have no HTML meta tags, so this is the only auto-fill
    // channel — fill only fields the base scrape left empty so we never clobber
    // a real value. Title stays the filename (embedded PDF titles are often
    // junk like "Microsoft Word - …"); author + date are the wins.
    var pdfMeta = window.OPS_PDF_META || {};
    if (pdfMeta.author && !out.author) out.author = pdfMeta.author;
    if (pdfMeta.date && !out.date) out.date = pdfMeta.date;
    return out;
  };
})();
