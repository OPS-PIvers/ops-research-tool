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
 * come back and a duplicate source was made. These rules reduce a database
 * article to the id that names it. Returns the canonical URL, or null for
 * every other site. Hosts are matched as a whole label so library proxies
 * (go-gale-com.content.elibrarymn.org) and direct hosts (go.gale.com) both hit.
 *
 * - Gale In Context: retrieve.do?docId=GALE|X (from a search: retrievalId,
 *   hitCount, currentPosition, searchId... in any order) and i.do?id=GALE|X
 *   (bookmark/proxy entry) are the same document. link.gale.com/apps/doc/X
 *   links keep their path.
 * - EBSCO Research: /c/<customer>/viewer/html/<token> and
 *   /c/<customer>/search/details/<token>?ctx=&pos=&q=... are the same record.
 */
function canonicalDatabaseUrl_(origin, path, queryStr) {
  const param = (name) => {
    const pair = queryStr.slice(1).split('&').find((kv) => kv.toLowerCase().indexOf(name + '=') === 0);
    return pair ? pair.slice(name.length + 1) : '';
  };
  if (/[\/.-]gale[.-]/i.test(origin)) {
    const docId = /\/retrieve\.do$/i.test(path) ? param('docid')
      : /\/i\.do$/i.test(path) ? param('id') : '';
    // GALE|X and GALE%7CX are the same id.
    if (docId) {
      return origin + path.replace(/[^\/]*$/, 'retrieve.do')
        + '?docId=' + docId.replace(/\|/g, '%7C').replace(/%7c/g, '%7C');
    }
    if (/\/apps\/doc\//i.test(path)) return origin + path;
  }
  if (/[\/.-]ebsco[.-]/i.test(origin)) {
    const m = path.match(/^(\/c\/[^\/]+)\/(?:viewer\/html|search\/details)\/([^\/]+)/i);
    if (m) return origin + m[1] + '/search/details/' + m[2];
  }
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
 * Google Drive file links → the file id, else null. Covers the viewer
 * (drive.google.com/file/d/<id>/view, also under /u/<n>/ or docs.google.com)
 * and open?id=<id> share links. A file previewed over a folder listing has no
 * id in the URL; "Open in new window" gives the /file/d/ form.
 */
function driveFileId(url) {
  const m = /^https:\/\/(?:drive|docs)\.google\.com\/(?:u\/\d+\/)?(?:file\/d\/([\w-]{10,})|open\?(?:[^#]*&)?id=([\w-]{10,}))/
    .exec(String(url || ''));
  return m ? (m[1] || m[2]) : null;
}

/** The one URL a Drive file is saved under, so every share-link variant is one source. */
function driveViewUrl(id) {
  return 'https://drive.google.com/file/d/' + id + '/view';
}

/** Where the file's bytes come from (the student's own Drive session). */
function driveDownloadUrl(id) {
  return 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(id);
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
  self.driveFileId = driveFileId;
  self.driveViewUrl = driveViewUrl;
  self.driveDownloadUrl = driveDownloadUrl;
}
