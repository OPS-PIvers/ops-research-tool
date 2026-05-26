/**
 * Best-effort metadata scrape — runs in the content script context once at
 * the moment a source is first created. Build plan §2: standard meta tags
 * only; whatever is missing is just an empty field. The student is the
 * verification fallback when they complete the citation in the sidebar.
 */
function scrapePageMeta() {
  return {
    title: document.title || '',
    site: metaContent_('og:site_name') || hostnameFallback_(),
    date: metaContent_('article:published_time')
        || metaContent_('article:modified_time')
        || metaContent_('og:updated_time')
        || '',
    author: metaContent_('article:author')
         || metaContent_('author')
         || metaContent_('twitter:creator')
         || '',
  };
}

function metaContent_(nameOrProperty) {
  const sel = `meta[property="${nameOrProperty}"], meta[name="${nameOrProperty}"]`;
  const el = document.querySelector(sel);
  return (el && el.getAttribute('content')) || '';
}

function hostnameFallback_() {
  try {
    return location.hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

self.scrapePageMeta = scrapePageMeta;
