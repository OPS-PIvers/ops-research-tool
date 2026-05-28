/**
 * Best-effort metadata scrape — runs in the content script context once at
 * the moment a source is first created. Build plan §2: standard meta tags,
 * no readability/content-extraction libraries; whatever is missing is just an
 * empty field and the student is the verification fallback.
 *
 * Beyond the original OpenGraph/legacy tags, this reads the two richest
 * STANDARD metadata channels that news sites and academic databases actually
 * emit, which raises the auto-fill hit rate dramatically:
 *   - JSON-LD (schema.org Article / NewsArticle / ScholarlyArticle / Book)
 *   - Highwire Press (`citation_*`) and Dublin Core (`DC.*`) meta tags
 *
 * Returns a flat object. `title/site/date/author` stay as the four original
 * fields (mapped to discrete Sheet columns + the source label); the richer
 * keys ride along in `scrapedExtra`. Nothing here is authoritative — the
 * sidebar citation form pre-fills from it and the student verifies.
 */
function scrapePageMeta() {
  const jsonLd = extractJsonLd_();
  const title = firstNonEmpty_(
    jsonLd.title,
    metaContent_('og:title'),
    metaContent_('citation_title'),
    metaContent_('DC.title'),
    cleanDocumentTitle_());
  const author = firstNonEmpty_(
    jsonLd.author,
    metaContentJoined_('citation_author'),
    metaContent_('DC.creator'),
    metaContent_('article:author', { rejectUrl: true }),
    metaContent_('author'));
  const date = firstNonEmpty_(
    jsonLd.date,
    metaContent_('citation_publication_date'),
    metaContent_('citation_date'),
    metaContent_('article:published_time'),
    metaContent_('article:modified_time'),
    metaContent_('DC.date'),
    metaContent_('og:updated_time'));
  const publication = firstNonEmpty_(
    metaContent_('citation_journal_title'),
    jsonLd.publication);
  const publisher = firstNonEmpty_(
    metaContent_('citation_publisher'),
    metaContent_('DC.publisher'),
    jsonLd.publisher);
  const site = firstNonEmpty_(
    metaContent_('og:site_name'),
    publication,
    publisher,
    hostnameFallback_());
  const volume = metaContent_('citation_volume');
  const issue = metaContent_('citation_issue');
  const pages = citationPages_();
  const sourceType = inferSourceType_(jsonLd.type, publication, metaContent_('citation_isbn'));

  return {
    title: title,
    site: site,
    date: date,
    author: author,
    // Richer fields — stored in the scrapedExtra JSON column.
    publication: publication,
    publisher: publisher,
    volume: volume,
    issue: issue,
    pages: pages,
    sourceType: sourceType,
  };
}

function metaContent_(nameOrProperty, opts) {
  const sel = `meta[property="${nameOrProperty}"], meta[name="${nameOrProperty}"]`;
  const el = document.querySelector(sel);
  const val = ((el && el.getAttribute('content')) || '').trim();
  if (opts && opts.rejectUrl && /^https?:\/\//i.test(val)) return '';
  return val;
}

// Some tags (notably citation_author) repeat once per value. Take the first —
// the MLA formatter renders a single lead author and the student can add the
// rest. Returning just the first keeps the citation form clean.
function metaContentJoined_(name) {
  const els = document.querySelectorAll(`meta[name="${name}"], meta[property="${name}"]`);
  for (let i = 0; i < els.length; i++) {
    const v = (els[i].getAttribute('content') || '').trim();
    if (v) return v;
  }
  return '';
}

function citationPages_() {
  const first = metaContent_('citation_firstpage');
  const last = metaContent_('citation_lastpage');
  if (first && last) return first + '-' + last;
  return first || '';
}

function firstNonEmpty_() {
  for (let i = 0; i < arguments.length; i++) {
    const v = arguments[i];
    if (v && String(v).trim()) return String(v).trim();
  }
  return '';
}

// document.title usually carries a " - Site Name" / " | Site Name" suffix.
// Strip the last such segment so the title field isn't polluted. Only strips
// when there's a clear separator and a non-trivial head segment remains.
function cleanDocumentTitle_() {
  const raw = (document.title || '').trim();
  if (!raw) return '';
  const m = raw.match(/^(.*\S)\s+[|–—\-]\s+\S.*$/);
  if (m && m[1].length >= 8) return m[1].trim();
  return raw;
}

function hostnameFallback_() {
  try {
    return location.hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

// Map a schema.org @type / journal presence / ISBN to one of the four MLA
// source types. Conservative: only claims 'article' or 'book' on a strong
// signal, else 'website'. Never infers 'primary' — that's the student's call.
const ARTICLE_LD_TYPES_ = {
  Article: 1, NewsArticle: 1, ScholarlyArticle: 1, Report: 1,
  TechArticle: 1, BlogPosting: 1, MedicalScholarlyArticle: 1,
  ReportageNewsArticle: 1, AnalysisNewsArticle: 1, OpinionNewsArticle: 1,
};
function inferSourceType_(ldType, publication, isbn) {
  if (isbn || ldType === 'Book') return 'book';
  if (publication) return 'article';
  if (ldType && ARTICLE_LD_TYPES_[ldType]) return 'article';
  return '';
}

// ---- JSON-LD ----

// Parse every <script type="application/ld+json"> block, flatten @graph, and
// pull citation-relevant fields from the first Article/Book-family node.
// Fully defensive: any malformed block is skipped.
function extractJsonLd_() {
  const out = { title: '', author: '', date: '', publisher: '', publication: '', type: '' };
  let scripts;
  try {
    scripts = document.querySelectorAll('script[type="application/ld+json"]');
  } catch (e) {
    return out;
  }
  const nodes = [];
  for (let i = 0; i < scripts.length; i++) {
    let parsed;
    try {
      parsed = JSON.parse(scripts[i].textContent || '');
    } catch (e) {
      continue;
    }
    collectLdNodes_(parsed, nodes);
  }
  // Prefer an Article/Book node; fall back to the first node with a headline.
  let chosen = null;
  for (let i = 0; i < nodes.length; i++) {
    const t = ldTypeOf_(nodes[i]);
    if (t === 'Book' || ARTICLE_LD_TYPES_[t]) { chosen = nodes[i]; out.type = t; break; }
  }
  if (!chosen) {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i] && (nodes[i].headline || nodes[i].name)) { chosen = nodes[i]; break; }
    }
  }
  if (!chosen) return out;

  out.title = strOf_(chosen.headline || chosen.name);
  out.author = ldAuthor_(chosen.author);
  out.date = strOf_(chosen.datePublished || chosen.dateCreated || chosen.dateModified);
  if (chosen.publisher) out.publisher = strOf_(chosen.publisher.name || chosen.publisher);
  if (chosen.isPartOf) out.publication = strOf_(chosen.isPartOf.name || chosen.isPartOf);
  return out;
}

function collectLdNodes_(parsed, acc) {
  if (!parsed || typeof parsed !== 'object') return;
  if (Array.isArray(parsed)) {
    parsed.forEach((p) => collectLdNodes_(p, acc));
    return;
  }
  if (Array.isArray(parsed['@graph'])) {
    parsed['@graph'].forEach((p) => collectLdNodes_(p, acc));
  }
  acc.push(parsed);
}

function ldTypeOf_(node) {
  if (!node) return '';
  const t = node['@type'];
  if (Array.isArray(t)) {
    for (let i = 0; i < t.length; i++) {
      if (t[i] === 'Book' || ARTICLE_LD_TYPES_[t[i]]) return t[i];
    }
    return t[0] || '';
  }
  return t || '';
}

// JSON-LD author may be a string, an object {name}, or an array of either.
function ldAuthor_(author) {
  if (!author) return '';
  if (typeof author === 'string') return author.trim();
  if (Array.isArray(author)) return author.length ? ldAuthor_(author[0]) : '';
  if (typeof author === 'object') return strOf_(author.name);
  return '';
}

function strOf_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.length ? strOf_(v[0]) : '';
  if (typeof v === 'object') return strOf_(v.name || v['@value'] || '');
  return String(v).trim();
}

self.scrapePageMeta = scrapePageMeta;
