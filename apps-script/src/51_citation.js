/**
 * Citation formatter — style dispatcher per build plan §2.
 *
 *   formatCitation(fields, style) → { text, italics: [[start, end], ...] }
 *
 * `text` is the rendered citation. `italics` is a list of half-open
 * character ranges within `text` that should be italicized when inserting
 * into a Google Doc (book / journal / site titles).
 *
 * v1 ships MLA 9 only. Chicago and APA can be added as separate
 * formatXxx_ functions and switched on `style` later without touching
 * call sites.
 *
 * Supported source types (MLA): website, article, book, primary.
 */

function formatCitation(fields, style) {
  const s = (style || 'mla').toLowerCase();
  if (s === 'mla') return formatMLA_(coerceFieldsToStrings_(fields));
  throw new Error('Unsupported citation style: ' + style);
}

/**
 * Defensive: Sheets autocoerces numeric-looking cells to numbers and date
 * cells to Date objects, and a round-tripped JSON.parse on citationFields
 * may surface those native types too. Everything downstream assumes strings,
 * so normalize here once. Returns a NEW object (does not mutate the input).
 */
function coerceFieldsToStrings_(fields) {
  const out = {};
  const src = fields || {};
  Object.keys(src).forEach((k) => {
    const v = src[k];
    if (v === null || v === undefined) out[k] = '';
    else if (typeof v === 'string') out[k] = v;
    else out[k] = String(v);
  });
  return out;
}

/**
 * Build the MLA in-text (parenthetical) form for a source.
 *   Author present  → "(Smith)" or "(Smith 23)" if page given
 *   No author       → "(\"Short Title\")" for quoted-title types,
 *                     "(Short Title)" for italic-title types (book)
 * The parentheses are included in the returned text. Page is optional —
 * student can supply it from the sidebar input.
 *
 * v1 returns a plain string. Italics on book titles are NOT applied —
 * the student can italicize manually if it matters to them. Keeping the
 * insertion simple avoids fighting with cursor offsets on the Docs side.
 */
function formatInlineCitation(fields, style, page) {
  const s = (style || 'mla').toLowerCase();
  if (s !== 'mla') throw new Error('Unsupported citation style: ' + style);
  return formatMlaInline_(coerceFieldsToStrings_(fields), page);
}

function formatMlaInline_(f, page) {
  const lastName = mlaInlineAuthorLastName_(f.author);
  const pageStr = page ? String(page).trim() : '';
  if (lastName) {
    return pageStr ? '(' + lastName + ' ' + pageStr + ')' : '(' + lastName + ')';
  }
  // No author — fall back to a shortened title. Quoted for short works,
  // bare (italic in practice) for italic-title works.
  const title = (f.title || '').trim();
  if (!title) return '';
  const shortTitle = shortenTitleForInline_(title);
  const sourceType = String(f.sourceType || 'website').toLowerCase();
  const italicTitle = sourceType === 'book';
  const inner = italicTitle ? shortTitle : '"' + shortTitle + '"';
  return pageStr ? '(' + inner + ' ' + pageStr + ')' : '(' + inner + ')';
}

function mlaInlineAuthorLastName_(author) {
  if (!author) return '';
  const s = author.trim();
  if (!s) return '';
  // "Doe, Jane" → "Doe". "Jane Doe" → "Doe". Single token → that token.
  if (s.indexOf(',') >= 0) return s.split(',')[0].trim();
  const parts = s.split(/\s+/);
  return parts[parts.length - 1];
}

function shortenTitleForInline_(title) {
  // Strip leading articles, then take the first 4 words or up to first
  // punctuation, whichever is shorter. MLA convention is "first noun phrase."
  const stripped = title.replace(/^(the|a|an)\s+/i, '');
  const upToPunct = stripped.split(/[:;—–\-]/)[0].trim();
  const words = upToPunct.split(/\s+/).slice(0, 4);
  return words.join(' ');
}

function formatMLA_(f) {
  const sourceType = String(f.sourceType || 'website').toLowerCase();
  switch (sourceType) {
    case 'website': return mlaWebsite_(f);
    case 'article': return mlaArticle_(f);
    case 'book':    return mlaBook_(f);
    case 'primary': return mlaPrimary_(f);
    default:        return mlaWebsite_(f);
  }
}

// ---- builders (each returns a list of { text, italic } parts) ----

function mlaWebsite_(f) {
  const parts = [];
  const author = formatAuthorMLA_(f.author);
  if (author) parts.push({ text: author + '.', italic: false });
  if (f.title) parts.push({ text: '"' + f.title + '."', italic: false });
  if (f.siteName) parts.push({ text: f.siteName, italic: true });
  if (f.publishedDate) parts.push({ text: formatMlaDate_(f.publishedDate), italic: false });
  if (f.url) parts.push({ text: f.url, italic: false });
  return joinMlaParts_(parts);
}

function mlaArticle_(f) {
  const parts = [];
  const author = formatAuthorMLA_(f.author);
  if (author) parts.push({ text: author + '.', italic: false });
  if (f.title) parts.push({ text: '"' + f.title + '."', italic: false });
  const pub = f.publication || f.siteName;
  if (pub) parts.push({ text: pub, italic: true });
  if (f.publishedDate) parts.push({ text: formatMlaDate_(f.publishedDate), italic: false });
  if (f.volume || f.issue) {
    const vi = [];
    if (f.volume) vi.push('vol. ' + f.volume);
    if (f.issue) vi.push('no. ' + f.issue);
    parts.push({ text: vi.join(', '), italic: false });
  }
  if (f.pages) parts.push({ text: 'pp. ' + f.pages, italic: false });
  if (f.url) parts.push({ text: f.url, italic: false });
  return joinMlaParts_(parts);
}

function mlaBook_(f) {
  const parts = [];
  const author = formatAuthorMLA_(f.author);
  if (author) parts.push({ text: author + '.', italic: false });
  if (f.title) parts.push({ text: f.title, italic: true });
  if (f.publisher) parts.push({ text: f.publisher, italic: false });
  if (f.publishedDate) parts.push({ text: yearOnly_(f.publishedDate), italic: false });
  return joinMlaParts_(parts);
}

function mlaPrimary_(f) {
  const parts = [];
  const author = formatAuthorMLA_(f.author);
  if (author) parts.push({ text: author + '.', italic: false });
  if (f.title) parts.push({ text: '"' + f.title + '."', italic: false });
  if (f.publishedDate) parts.push({ text: formatMlaDate_(f.publishedDate), italic: false });
  if (f.archive) parts.push({ text: f.archive, italic: false });
  if (f.url) parts.push({ text: f.url, italic: false });
  return joinMlaParts_(parts);
}

// ---- joiner / utilities ----

function joinMlaParts_(parts) {
  if (parts.length === 0) return { text: '', italics: [] };
  let out = '';
  const italics = [];
  parts.forEach((p, i) => {
    if (i > 0) {
      const prevText = parts[i - 1].text;
      // If previous part already ends a sentence (period/quote/etc) use single
      // space; otherwise a comma + space separator.
      const sep = /[.!?"]$/.test(prevText) ? ' ' : ', ';
      out += sep;
    }
    const start = out.length;
    out += p.text;
    if (p.italic) italics.push([start, out.length]);
  });
  if (!/[.!?]$/.test(out)) out += '.';
  return { text: out, italics };
}

function formatAuthorMLA_(author) {
  if (!author) return '';
  // Accept either a string ("Jane Doe") or already-formatted "Doe, Jane".
  if (author.indexOf(',') >= 0) return author;
  const parts = author.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  const rest = parts.slice(0, parts.length - 1).join(' ');
  return last + ', ' + rest;
}

const MLA_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];

// Month name / abbreviation → 1-based month number. Covers full names and the
// common abbreviations (incl. "sept"). Built once.
const MONTH_LOOKUP_ = (function () {
  const groups = [
    ['jan', 'january'], ['feb', 'february'], ['mar', 'march'], ['apr', 'april'],
    ['may'], ['jun', 'june'], ['jul', 'july'], ['aug', 'august'],
    ['sep', 'sept', 'september'], ['oct', 'october'], ['nov', 'november'], ['dec', 'december'],
  ];
  const map = {};
  groups.forEach((aliases, i) => aliases.forEach((a) => { map[a] = i + 1; }));
  return map;
})();

function formatMlaDate_(raw) {
  const p = parseDateParts_(raw);
  if (!p) return rawDateString_(raw);
  if (p.month == null) return String(p.year);
  const mon = MLA_MONTHS[p.month - 1];
  return (p.day == null ? '' : p.day + ' ') + mon + ' ' + p.year;
}

function yearOnly_(raw) {
  const p = parseDateParts_(raw);
  if (!p) return rawDateString_(raw);
  return String(p.year);
}

function rawDateString_(raw) {
  return raw == null ? '' : String(raw).trim();
}

/**
 * Parse a free-form published-date string into { year, month, day } with
 * integer parts: month is 1-12, day is 1-31, and month/day are null when the
 * input doesn't supply them (so "2020" → year only, "Apr 2020" → year+month).
 * Returns null when no usable year can be found — callers then echo the raw
 * string unchanged (e.g. "n.d.", "Spring 2020", "c. 1850" stay verbatim).
 *
 * GAS V8's `new Date(str)` is deliberately avoided: it rejects ordinals
 * ("April 16th, 2020"), mishandles separator-less compact dates ("20200416"),
 * and round-tripping through a Date silently shifts the day by the script
 * timezone. Everything here is hand-parsed into plain integers instead.
 *
 * Recognized shapes:
 *   2020-04-16  2020/4/6  2020.04.16  2020-04  2020   (year-first, separated)
 *   20200416 (YYYYMMDD)  202004 (YYYYMM)              (compact numeric)
 *   4/16/2020  04-16-2020                             (US month/day/year)
 *   April 16, 2020  Apr. 16 2020  April 16th, 2020    (month name + day)
 *   16 April 2020  16 Apr. 2020  1st March 2021       (day-first month name)
 *   April 2020  Sept 2020                             (month name + year)
 */
function parseDateParts_(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // Drop ordinal suffixes: "16th" → "16", "1st" → "1", "3rd" → "3".
  s = s.replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, '$1');

  // Year-first with separators (or year alone): 2020-04-16, 2020/4, 2020.
  let m = s.match(/^(\d{4})(?:[-/.](\d{1,2}))?(?:[-/.](\d{1,2}))?$/);
  if (m) return clampDateParts_(+m[1], m[2] != null ? +m[2] : null, m[3] != null ? +m[3] : null);

  // Compact numeric: 20200416 (YYYYMMDD) or 202004 (YYYYMM).
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return clampDateParts_(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})(\d{2})$/);
  if (m) return clampDateParts_(+m[1], +m[2], null);

  // US numeric month/day/year: 4/16/2020, 04-16-2020, 4.16.2020.
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return clampDateParts_(+m[3], +m[1], +m[2]);

  // Month-name forms — locate a month token, a 4-digit year, and an optional
  // 1-2 digit day (the first such number; a 4-digit year can't match \d{1,2}).
  const tokens = s.toLowerCase().match(/[a-z]+/g) || [];
  let month = null;
  for (let i = 0; i < tokens.length; i++) {
    if (MONTH_LOOKUP_[tokens[i]] != null) { month = MONTH_LOOKUP_[tokens[i]]; break; }
  }
  if (month != null) {
    const yearM = s.match(/\b(\d{4})\b/);
    if (!yearM) return null;
    const dayM = s.match(/\b(\d{1,2})\b/);
    return clampDateParts_(+yearM[1], month, dayM ? +dayM[1] : null);
  }
  return null;
}

function clampDateParts_(year, month, day) {
  if (!year || year < 100 || year > 3000) return null;
  if (month != null && (month < 1 || month > 12)) return null;
  if (month == null) return { year: year, month: null, day: null };
  if (day != null && (day < 1 || day > 31)) day = null;
  return { year: year, month: month, day: day };
}
