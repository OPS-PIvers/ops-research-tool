/**
 * URL normalization — must produce the same output as apps-script/src/03_utils.js
 * `normalizeUrl_`. The backend uses this to dedupe sources; if the two
 * implementations drift, the source-per-page guarantee breaks.
 *
 * Pure-string parser (no URL constructor) to mirror the GAS V8 workaround.
 * Tracking params + fragments are stripped; everything else preserved.
 */
const DROP_QUERY_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gclid', 'fbclid', 'mc_cid', 'mc_eid', '_ga', 'ref', 'ref_src',
  'igshid', 'yclid', 'msclkid',
]);

/**
 * Research-database article URLs carry per-search state, so one article
 * reached from two searches looked like two pages: its saved highlights didn't
 * come back and a duplicate source was made. Gale In Context (direct or through
 * a library proxy like go-gale-com.content.elibrarymn.org) puts retrievalId,
 * hitCount, currentPosition, searchId... on retrieve.do, in a different order
 * each time; only docId names the document. Returns the canonical URL, or null
 * for every other site.
 */
function canonicalDatabaseUrl_(origin, path, queryStr) {
  if (!/[\/.-]gale[.-]/i.test(origin)) return null;
  if (/\/retrieve\.do$/i.test(path)) {
    const pair = queryStr.slice(1).split('&').find((kv) => /^docid=/i.test(kv));
    const docId = pair ? pair.slice(pair.indexOf('=') + 1) : '';
    // GALE|X and GALE%7CX are the same id.
    if (docId) return origin + path + '?docId=' + docId.replace(/\|/g, '%7C').replace(/%7c/g, '%7C');
  }
  // Gale's citation/bookmark links: link.gale.com/apps/doc/<docId>/<product>?u=&sid=&xid=
  if (/\/apps\/doc\//i.test(path)) return origin + path;
  return null;
}

function normalizeUrl(rawUrl) {
  if (!rawUrl) return '';
  const s = String(rawUrl).trim();
  const m = s.match(/^([a-z][a-z0-9+.\-]*:\/\/[^\/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/i);
  if (!m) return s;
  const origin = m[1];
  const path = m[2] || '/';
  const queryStr = m[3] || '';
  const canonical = canonicalDatabaseUrl_(origin, path, queryStr);
  if (canonical) return canonical;
  if (!queryStr) return origin + path;
  const kept = queryStr.slice(1).split('&').filter(Boolean).filter((kv) => {
    const eq = kv.indexOf('=');
    const key = (eq >= 0 ? kv.slice(0, eq) : kv).toLowerCase();
    return !DROP_QUERY_PARAMS.has(key);
  });
  return origin + path + (kept.length ? '?' + kept.join('&') : '');
}

/**
 * The page a stored source row belongs to, under the CURRENT normalizer. Rows
 * saved before a rule change (e.g. the Gale docId rule) keep their old
 * normalizedUrl, so compare on this — re-derived from rawUrl — not on the
 * stored column.
 */
function sourcePageUrl(source) {
  return normalizeUrl((source && (source.rawUrl || source.normalizedUrl)) || '');
}

/**
 * The URL of the page whose sources we're capturing — normally location.href,
 * but inside the PDF panel (pdf/panel.html?src=<pdf>) location.href is the
 * chrome-extension wrapper URL, not the PDF. The panel shim (pdf/shim.js) sets
 * self.OPS_PAGE_URL to the real ?src= value, so every place that keys a source
 * row, a citation URL, or a highlight lookup on "the current page" must read
 * this accessor instead of location.href directly — otherwise saved sources
 * point at the wrapper URL instead of the actual PDF.
 */
function opsPageUrl() {
  if (typeof self !== 'undefined' && self.OPS_PAGE_URL) return self.OPS_PAGE_URL;
  return (typeof location !== 'undefined' && location.href) || '';
}

if (typeof self !== 'undefined') {
  self.normalizeUrl = normalizeUrl;
  self.sourcePageUrl = sourcePageUrl;
  self.DROP_QUERY_PARAMS = DROP_QUERY_PARAMS;
  self.opsPageUrl = opsPageUrl;
}
