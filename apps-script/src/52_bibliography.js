/**
 * Insert the annotated bibliography at the current cursor in the active
 * Google Doc. Sources are split into Primary / Secondary alphabetized
 * sections; each entry is the formatted citation followed by an indented
 * annotation paragraph. Italics on book/site/publication titles are
 * preserved using the italics ranges returned by formatCitation().
 *
 * This is the only "insertion" button the spec calls for in the sidebar
 * (build plan §2 — "no insert-as-quote button").
 */

function insertAnnotatedBibliography(projectId) {
  const doc = DocumentApp.getActiveDocument();
  if (!doc) throw new Error('No active document.');
  const actorEmail = getActorEmail_();
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown project ' + projectId);
  const bundle = getBundle_(project.bundleId);
  const style = (bundle && bundle.style) || 'mla';

  const sources = readSourcesForActor_(actorEmail, projectId);
  if (sources.length === 0) throw new Error('No sources saved for this project yet.');

  const primary = [];
  const secondary = [];
  sources.forEach((s) => {
    const fields = parseCitationFields_(s);
    const formatted = formatCitation(fields, style);
    const entry = {
      sortKey: bibSortKey_(fields, formatted.text),
      text: formatted.text,
      italics: formatted.italics || [],
      annotation: s.annotation || '',
    };
    if (s.primarySecondary === 'primary') primary.push(entry);
    else if (s.primarySecondary === 'secondary') secondary.push(entry);
    // unset → skipped from bibliography per build plan §2 ("hard validation —
    // you must classify this source before it counts as complete")
  });
  primary.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  secondary.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const cursor = doc.getCursor();
  const body = doc.getBody();
  const insertIndex = cursor ? indexOfCursor_(body, cursor) : body.getNumChildren();

  let idx = insertIndex;
  idx = appendHeading_(body, idx, 'Annotated Bibliography');
  if (primary.length > 0) {
    idx = appendSectionHeading_(body, idx, 'Primary Sources');
    primary.forEach((e) => { idx = appendBibEntry_(body, idx, e); });
  }
  if (secondary.length > 0) {
    idx = appendSectionHeading_(body, idx, 'Secondary Sources');
    secondary.forEach((e) => { idx = appendBibEntry_(body, idx, e); });
  }
  return { ok: true, inserted: { primary: primary.length, secondary: secondary.length } };
}

function parseCitationFields_(source) {
  let fields = {};
  if (source.citationFields) {
    try { fields = JSON.parse(source.citationFields) || {}; }
    catch (e) { fields = {}; }
  }
  // Fill in fallbacks from scraped values so an unedited source still emits
  // something reasonable rather than an empty citation.
  if (!fields.title && source.scrapedTitle) fields.title = source.scrapedTitle;
  if (!fields.siteName && source.scrapedSite) fields.siteName = source.scrapedSite;
  if (!fields.publishedDate && source.scrapedDate) fields.publishedDate = source.scrapedDate;
  if (!fields.author && source.scrapedAuthor) fields.author = source.scrapedAuthor;
  if (!fields.url && source.rawUrl) fields.url = source.rawUrl;
  if (!fields.sourceType && source.sourceType) fields.sourceType = source.sourceType;
  if (!fields.accessDate && source.accessDate) fields.accessDate = source.accessDate;
  // Coerce every value to a string. Sheets autocoerces numeric-looking cells
  // (e.g. a year scraped as "2024" returns as the number 2024) and Date cells
  // to native Date objects, both of which lack String methods like .replace.
  Object.keys(fields).forEach((k) => {
    if (fields[k] === null || fields[k] === undefined) fields[k] = '';
    else if (typeof fields[k] !== 'string') fields[k] = String(fields[k]);
  });
  return fields;
}

/** Sort key: author last name (lowercased), or title with leading articles stripped. */
function bibSortKey_(fields, citationText) {
  const author = String(fields.author || '').trim();
  if (author) {
    const lastFirst = author.indexOf(',') >= 0 ? author : (function () {
      const parts = author.split(/\s+/);
      return parts[parts.length - 1];
    })();
    return lastFirst.toLowerCase();
  }
  const title = String(fields.title || citationText || '').replace(/^(the|a|an)\s+/i, '');
  return title.toLowerCase();
}

function appendHeading_(body, idx, text) {
  const p = body.insertParagraph(idx, text);
  p.setHeading(DocumentApp.ParagraphHeading.HEADING1);
  return idx + 1;
}

function appendSectionHeading_(body, idx, text) {
  const p = body.insertParagraph(idx, text);
  p.setHeading(DocumentApp.ParagraphHeading.HEADING2);
  return idx + 1;
}

function appendBibEntry_(body, idx, entry) {
  // Citation paragraph with italics applied to the ranges from
  // formatCitation. MLA hanging indent: insert as a Normal paragraph with
  // a left indent on subsequent lines via setIndentFirstLine(0)/setIndentStart(36).
  const cite = body.insertParagraph(idx, entry.text);
  cite.setHeading(DocumentApp.ParagraphHeading.NORMAL);
  cite.setIndentFirstLine(0);
  cite.setIndentStart(36); // 0.5 inch in points
  applyItalicsRanges_(cite, entry.italics);
  let next = idx + 1;
  if (entry.annotation && entry.annotation.trim()) {
    const ann = body.insertParagraph(next, entry.annotation.trim());
    ann.setHeading(DocumentApp.ParagraphHeading.NORMAL);
    ann.setIndentStart(72); // 1.0 inch — nested under the citation
    ann.setIndentFirstLine(72);
    next++;
  }
  return next;
}

function applyItalicsRanges_(paragraph, ranges) {
  if (!ranges || ranges.length === 0) return;
  const text = paragraph.editAsText();
  ranges.forEach(([start, end]) => {
    if (typeof start !== 'number' || typeof end !== 'number' || end <= start) return;
    try { text.setItalic(start, end - 1, true); }
    catch (e) { /* out-of-range; skip silently */ }
  });
}

/**
 * Insert an MLA in-text (parenthetical) citation at the current cursor.
 * Looks up the source row, builds the parenthetical, and inserts as plain
 * text. `page` is optional — when omitted, the citation has no page number.
 */
function insertInlineCitation(projectId, sourceId, page) {
  const doc = DocumentApp.getActiveDocument();
  if (!doc) throw new Error('No active document.');
  const actorEmail = getActorEmail_();
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown project ' + projectId);
  const bundle = getBundle_(project.bundleId);
  const style = (bundle && bundle.style) || 'mla';

  const sources = readSourcesForActor_(actorEmail, projectId);
  const source = sources.find((s) => s.sourceId === sourceId);
  if (!source) throw new Error('Source not found in this project.');
  const fields = parseCitationFields_(source);
  const text = formatInlineCitation(fields, style, page);
  if (!text) throw new Error('No author or title available — edit the citation first.');

  const cursor = doc.getCursor();
  if (cursor) {
    const inserted = cursor.insertText(text);
    if (inserted) {
      // Move the cursor to just after the insertion so the next type lands
      // there, not before. setCursor takes an element + offset.
      try {
        doc.setCursor(doc.newPosition(inserted, inserted.getText().length));
      } catch (e) { /* setCursor occasionally rejects — non-fatal */ }
    } else {
      // Fall through to append-at-end path.
      appendAtBodyEnd_(doc.getBody(), text);
    }
  } else {
    appendAtBodyEnd_(doc.getBody(), text);
  }
  return { ok: true, text };
}

function appendAtBodyEnd_(body, text) {
  const last = body.getChild(body.getNumChildren() - 1);
  if (last && last.getType && last.getType() === DocumentApp.ElementType.PARAGRAPH) {
    last.asParagraph().appendText(text);
  } else {
    body.appendParagraph(text);
  }
}

/**
 * Best-effort: find the child index in the body that the cursor sits in,
 * so the bibliography is inserted at "around here" rather than at the end.
 * If the cursor lookup fails (some surfaces don't have a settable cursor),
 * we fall back to appending at the end.
 */
function indexOfCursor_(body, cursor) {
  try {
    const el = cursor.getElement();
    let walker = el;
    while (walker && walker.getParent && walker.getParent() !== body) {
      walker = walker.getParent();
    }
    if (walker && walker.getParent && walker.getParent() === body) {
      return body.getChildIndex(walker) + 1;
    }
  } catch (e) { /* fall through */ }
  return body.getNumChildren();
}
