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

// Tags the inserted bibliography block so a later insert can find + replace it
// rather than stacking a second copy.
const BIB_NAMED_RANGE = 'opsResearchBibliography';

// Back-compat entry point. The sidebar calls sidebarInsertBibliography, which
// routes here for the annotated variant.
function insertAnnotatedBibliography(projectId) {
  return insertBibliography_(projectId, true);
}

/**
 * Insert — or REPLACE — the bibliography at the cursor in the active Doc.
 *
 *   annotated=true  → "Annotated Bibliography": citation + indented annotation.
 *   annotated=false → "Works Cited": citations only, no annotations.
 *
 * The inserted block is wrapped in a named range (BIB_NAMED_RANGE). On a
 * subsequent insert of EITHER type, the previous block is removed and the new
 * one dropped in its place — so re-clicking updates the single bibliography
 * instead of appending copies. Sources are de-duplicated by URL first, then
 * partitioned by partitionBibliographySources_: unclassified (primary/secondary
 * unset) sources are always skipped per build plan §2, and for the ANNOTATED
 * variant a classified source with no annotation is also skipped (an annotated
 * entry with a blank annotation is incomplete). The sidebar warns the student
 * about both omission buckets before calling in, so this skip is acknowledged,
 * not silent.
 */
function insertBibliography_(projectId, annotated) {
  const doc = DocumentApp.getActiveDocument();
  if (!doc) throw new Error('No active document.');
  const actorEmail = getActorEmail_();
  const project = getProject_(projectId);
  if (!project) throw new Error('Unknown project ' + projectId);
  const bundle = getBundle_(project.bundleId);
  const style = (bundle && bundle.style) || 'mla';

  const sources = dedupeSourcesByUrl_(readSourcesForActor_(actorEmail, projectId), []).sources;
  if (sources.length === 0) throw new Error('No sources saved for this project yet.');

  const toEntry = (s) => {
    const fields = buildCitationFields_(s);
    const formatted = formatCitation(fields, style);
    return {
      sortKey: bibSortKey_(fields, formatted.text),
      text: formatted.text,
      italics: formatted.italics || [],
      annotation: s.annotation || '',
    };
  };
  const parts = partitionBibliographySources_(sources, annotated);
  const primary = parts.primary.map(toEntry).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  const secondary = parts.secondary.map(toEntry).sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const body = doc.getBody();
  // Replace an existing OPS bibliography in place, if there is one; otherwise
  // insert at the cursor (or the end).
  let insertIndex = removeExistingBibliography_(doc, body);
  if (insertIndex < 0) {
    const cursor = doc.getCursor();
    insertIndex = cursor ? indexOfCursor_(body, cursor) : body.getNumChildren();
  }

  const startIndex = insertIndex;
  let idx = insertIndex;
  idx = appendHeading_(body, idx, annotated ? 'Annotated Bibliography' : 'Works Cited');
  if (primary.length > 0) {
    idx = appendSectionHeading_(body, idx, 'Primary Sources');
    primary.forEach((e) => { idx = appendBibEntry_(body, idx, e, annotated); });
  }
  if (secondary.length > 0) {
    idx = appendSectionHeading_(body, idx, 'Secondary Sources');
    secondary.forEach((e) => { idx = appendBibEntry_(body, idx, e, annotated); });
  }
  wrapBibliographyRange_(doc, body, startIndex, idx);
  return { ok: true, annotated: !!annotated, inserted: { primary: primary.length, secondary: secondary.length } };
}

/**
 * Decide which sources make it into the bibliography and which are left out.
 * Pure (no DocumentApp/Sheets) so it is unit-testable and so the rule lives in
 * exactly one place — the Docs sidebar mirrors this same rule client-side to
 * warn the student before inserting (see bibliographyOmissions_ in
 * sidebar_js.html); keep the two in sync.
 *
 *   - A source must be classified primary/secondary to appear at all
 *     (unclassified → omitted, reason 'unclassified', per build plan §2).
 *   - For the ANNOTATED variant, a classified source must ALSO have a non-empty
 *     annotation (classified-but-blank → omitted, reason 'no-annotation'). The
 *     "Works Cited" variant has no annotations, so annotation never gates it.
 *
 * Returns { primary:[source], secondary:[source], omitted:[{source, reason}] }.
 */
function partitionBibliographySources_(sources, annotated) {
  const primary = [];
  const secondary = [];
  const omitted = [];
  (sources || []).forEach((s) => {
    const ps = s.primarySecondary;
    if (ps !== 'primary' && ps !== 'secondary') {
      omitted.push({ source: s, reason: 'unclassified' });
      return;
    }
    if (annotated && !(s.annotation && String(s.annotation).trim())) {
      omitted.push({ source: s, reason: 'no-annotation' });
      return;
    }
    (ps === 'primary' ? primary : secondary).push(s);
  });
  return { primary: primary, secondary: secondary, omitted: omitted };
}

/**
 * Remove a previously-inserted OPS bibliography (the paragraphs covered by the
 * BIB_NAMED_RANGE) and the named range itself. Returns the body child index
 * where the block started so the replacement lands in the same spot, or -1 if
 * none was found.
 */
function removeExistingBibliography_(doc, body) {
  const ranges = doc.getNamedRanges(BIB_NAMED_RANGE);
  if (!ranges || ranges.length === 0) return -1;
  const elsByIndex = {};
  ranges.forEach((nr) => {
    nr.getRange().getRangeElements().forEach((re) => {
      let el = re.getElement();
      while (el && el.getParent && el.getParent() !== body) el = el.getParent();
      if (el && el.getParent && el.getParent() === body) {
        elsByIndex[body.getChildIndex(el)] = el;
      }
    });
    nr.remove();
  });
  const indices = Object.keys(elsByIndex).map(Number);
  if (indices.length === 0) return -1;
  const firstIndex = Math.min.apply(null, indices);
  // Remove by element reference (index-independent). try/catch covers the rare
  // edge where the bibliography is the doc's only content — Docs forbids
  // removing the last paragraph, so it's left in place harmlessly.
  indices.forEach((i) => {
    try { elsByIndex[i].removeFromParent(); } catch (e) { /* last paragraph — leave it */ }
  });
  return firstIndex;
}

/** Wrap the just-inserted bibliography paragraphs [startIndex, endIndex) in a
 *  named range so the next insert can find and replace them. */
function wrapBibliographyRange_(doc, body, startIndex, endIndex) {
  if (endIndex <= startIndex) return;
  const rb = doc.newRange();
  const n = body.getNumChildren();
  for (let i = startIndex; i < endIndex && i < n; i++) {
    try { rb.addElement(body.getChild(i)); } catch (e) { /* unsupported element type; skip */ }
  }
  try { doc.addNamedRange(BIB_NAMED_RANGE, rb.build()); }
  catch (e) { /* nothing addable — skip tagging */ }
}

/**
 * Build the EFFECTIVE citation fields for rendering: the student's
 * citationFields JSON, with blanks filled from the discrete scraped* columns
 * and rawUrl, then coerced to strings. An unedited source (citationFields
 * '{}') therefore still emits a real citation from its scraped metadata.
 *
 * Distinct from 62_aggregator.js's `parseCitationFields_`, which parses ONLY
 * the citationFields JSON (no scraped fallback) — that one feeds the dashboard
 * "citation complete" metric, which must reflect what the student explicitly
 * entered. The two share GAS's single global namespace, so they MUST keep
 * distinct names: a same-named "mirror" in 62 silently shadowed this richer
 * version (62 loads after 52), which is exactly what dropped the scraped
 * fallback and left scraped-only sources blank in the bibliography.
 */
function buildCitationFields_(source) {
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

function appendBibEntry_(body, idx, entry, includeAnnotation) {
  // Citation paragraph with italics applied to the ranges from
  // formatCitation. MLA hanging indent: insert as a Normal paragraph with
  // a left indent on subsequent lines via setIndentFirstLine(0)/setIndentStart(36).
  const cite = body.insertParagraph(idx, entry.text);
  cite.setHeading(DocumentApp.ParagraphHeading.NORMAL);
  cite.setIndentFirstLine(0);
  cite.setIndentStart(36); // 0.5 inch in points
  applyItalicsRanges_(cite, entry.italics);
  let next = idx + 1;
  if (includeAnnotation && entry.annotation && entry.annotation.trim()) {
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
  const fields = buildCitationFields_(source);
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
