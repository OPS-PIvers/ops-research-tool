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
  if (s === 'mla') return formatMLA_(fields || {});
  throw new Error('Unsupported citation style: ' + style);
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

function formatMlaDate_(raw) {
  if (!raw) return '';
  const d = parseDateLoose_(raw);
  if (!d) return String(raw);
  return d.getDate() + ' ' + MLA_MONTHS[d.getMonth()] + ' ' + d.getFullYear();
}

function yearOnly_(raw) {
  if (!raw) return '';
  const d = parseDateLoose_(raw);
  if (!d) return String(raw);
  return String(d.getFullYear());
}

function parseDateLoose_(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (iso) {
    const y = +iso[1], m = +iso[2] - 1, d = +(iso[3] || '1');
    const dt = new Date(Date.UTC(y, m, d));
    return isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}
