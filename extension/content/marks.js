/**
 * In-session colored spans. Build plan §2:
 *   - Wraps the selected text in a colored <span>.
 *   - Stays marked for the rest of the session on this page.
 *   - Disappears on reload — re-anchoring is explicitly out of scope.
 *   - Click on a mark → focus its entry in the sidebar IF the sidebar is
 *     open (message passing); otherwise no-op.
 *
 * Implementation: when the user has a Range selected, we wrap each Text
 * node in the range with a span. This is the simplest reliable approach that
 * handles selections spanning multiple inline elements.
 */
const MARK_CLASS = 'ops-research-mark';
const MARK_ATTR = 'data-ops-highlight-id';

function wrapRangeWithMark(range, color, highlightId) {
  // Snapshot range bounds BEFORE any DOM mutation. splitText() mutates the
  // live Range in place (per spec), so reading endContainer/endOffset after
  // a split returns surprising values.
  const startContainer = range.startContainer;
  const startOffset = range.startOffset;
  const endContainer = range.endContainer;
  const endOffset = range.endOffset;

  // Same text node case — the most common (a word or phrase selected
  // inside one paragraph). Previously buggy: my multi-node logic compared
  // endContainer to the original node, but after splitText the live Range
  // pointed at the NEW right-side node, so the end split was skipped and
  // the whole right side of the paragraph got the highlight color (or, if
  // it included a block boundary, the wrap silently failed and no color
  // appeared at all).
  if (startContainer === endContainer && startContainer.nodeType === Node.TEXT_NODE) {
    let node = startContainer;
    let localEndOffset = endOffset;
    if (startOffset > 0) {
      node = node.splitText(startOffset);
      localEndOffset = endOffset - startOffset;
    }
    if (localEndOffset < node.length) {
      node.splitText(localEndOffset);
    }
    wrapNodeWithSpan_(node, color, highlightId);
    return;
  }

  // Multi-node case (selection spans across inline elements like Wikipedia
  // reference links).
  const textNodes = collectTextNodesInRange_(range);
  if (textNodes.length === 0) {
    console.warn('[OPS] wrapRangeWithMark: no text nodes in range');
    return;
  }

  const lastIdx = textNodes.length - 1;
  if (textNodes[0] === startContainer && startOffset > 0) {
    textNodes[0] = textNodes[0].splitText(startOffset);
  }
  if (textNodes[lastIdx] === endContainer && endOffset < textNodes[lastIdx].length) {
    textNodes[lastIdx].splitText(endOffset);
  }
  textNodes.forEach((tn) => wrapNodeWithSpan_(tn, color, highlightId));
}

function wrapNodeWithSpan_(tn, color, highlightId) {
  if (!tn.textContent || !tn.parentNode) return;
  const span = document.createElement('span');
  span.className = MARK_CLASS;
  span.setAttribute(MARK_ATTR, highlightId);
  // !important defeats any host-page CSS that tries to flatten span
  // backgrounds (`span { background: transparent !important; }` is rare
  // but real on some news sites). setProperty is the only way to add
  // !important from JS — `style.backgroundColor = …` cannot.
  //
  // 35% alpha makes the highlight translucent — text underneath remains
  // readable. Required for the PDF panel (text is on a canvas behind the
  // transparent text layer; a solid background would cover it). Also
  // matches real-world highlighter pigment behavior on plain web pages.
  span.style.setProperty('background-color', toRgba_(color, 0.35), 'important');
  span.style.setProperty('border-radius', '2px', 'important');
  span.style.setProperty('padding', '0', 'important');
  tn.parentNode.insertBefore(span, tn);
  span.appendChild(tn);
}

/**
 * Convert a #rgb / #rrggbb hex color to rgba(r,g,b,alpha). Passes other
 * forms (already-rgba, named colors) through unchanged.
 */
function toRgba_(color, alpha) {
  if (!color || typeof color !== 'string') return color;
  const trimmed = color.trim();
  if (!trimmed.startsWith('#')) return trimmed;
  let h = trimmed.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6) return trimmed;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return trimmed;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function collectTextNodesInRange_(range) {
  const walker = document.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
        if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
        // Skip text inside script/style/etc.
        const parent = node.parentNode;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.nodeName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  return nodes;
}

// Click on an in-session mark → focus its entry in the in-page sidebar
// (OpsSidebar is defined in sidebar.js, loaded earlier in the content_scripts list).
document.addEventListener('click', (e) => {
  const span = e.target.closest && e.target.closest('.' + MARK_CLASS);
  if (!span) return;
  const highlightId = span.getAttribute(MARK_ATTR);
  if (!highlightId) return;
  if (self.OpsSidebar) self.OpsSidebar.focus(highlightId);
});

self.wrapRangeWithMark = wrapRangeWithMark;
self.MARK_CLASS = MARK_CLASS;
self.MARK_ATTR = MARK_ATTR;

/**
 * Reverse of wrapRangeWithMark. For every span tagged with the given
 * highlightId, pull its child nodes back out into the parent and delete
 * the span. Then normalize() the affected parents to merge the text
 * nodes we previously split during wrap — the DOM ends up looking
 * identical to its pre-highlight state.
 */
function unwrapMark(highlightId) {
  const spans = document.querySelectorAll(`.${MARK_CLASS}[${MARK_ATTR}="${highlightId}"]`);
  const parents = new Set();
  spans.forEach((span) => {
    const parent = span.parentNode;
    if (!parent) return;
    parents.add(parent);
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
  });
  parents.forEach((p) => p.normalize());
}

self.unwrapMark = unwrapMark;

/**
 * Re-anchor a batch of server-loaded highlights onto the current page.
 *
 * Approach: walk all eligible text nodes once, build a flat concatenated
 * string + a segment map (node, start, end in flat). For each highlight,
 * indexOf its highlightedText in flat — that gives the absolute position;
 * map back to (startNode, startOffset, endNode, endOffset), build a Range,
 * wrap it.
 *
 * Limitations (acceptable failure modes — sidebar surfaces a "not found"
 * indicator instead of silently misanchoring):
 *  - Exact match only. If the page's whitespace differs from the saved
 *    text (rare — most pages serialize whitespace consistently), no match.
 *  - Picks the FIRST occurrence. If the highlighted phrase appears 5 times
 *    on the page and the original was the 3rd, we'd anchor the 1st. To
 *    disambiguate later we'd need to also store some surrounding context;
 *    not worth the schema change for the rate this happens with long-form
 *    research-style highlights.
 *  - Overlapping highlights: the second one's range may be partially
 *    inside the first's span tree after the first wrap. Currently we
 *    compute all ranges UP FRONT against the unmutated DOM, then apply
 *    wraps; live Range updates do most of the right thing, but a perfect
 *    nested-highlight result isn't guaranteed.
 */
function reAnchorHighlights(highlights, colorForLabel, root) {
  root = root || document.body;
  // Skip highlights that are already anchored inside this root. This makes
  // the call idempotent so callers (especially the PDF panel, which fires
  // per-page anchoring on render AND on highlights-loaded) can invoke us
  // freely without producing nested mark spans.
  const alreadyAnchored = new Set();
  root.querySelectorAll('[' + MARK_ATTR + ']').forEach((el) => {
    alreadyAnchored.add(el.getAttribute(MARK_ATTR));
  });
  highlights = highlights.filter((h) => !alreadyAnchored.has(h.highlightId));

  const segments = [];
  let flat = '';
  const walker = document.createTreeWalker(
    root, NodeFilter.SHOW_TEXT,
    { acceptNode: (n) => {
      const parent = n.parentNode;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.nodeName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
      // Skip text inside our own sidebar host (it's in the page DOM too).
      let p = parent;
      while (p) {
        if (p.id === '__ops_research_sidebar_host') return NodeFilter.FILTER_REJECT;
        p = p.parentNode;
      }
      return NodeFilter.FILTER_ACCEPT;
    }}
  );
  let n;
  while ((n = walker.nextNode())) {
    const t = n.textContent;
    if (!t) continue;
    segments.push({ node: n, start: flat.length, end: flat.length + t.length });
    flat += t;
  }

  // Compute all Ranges against the unmutated DOM, THEN wrap each (so the
  // first wrap's text-node splits don't invalidate the segments map).
  // Live Range adjustment then carries the boundaries through subsequent
  // splits for the remaining wraps.
  // Whitespace-normalized fallback, built lazily on the first exact-match miss
  // and reused across highlights. The browser collapses whitespace when it
  // produces selection text (source line breaks, indentation, runs of spaces,
  // non-breaking spaces all become single spaces), but `flat` is the raw
  // textContent concatenation — so a highlight spanning any of those never
  // matched exactly and was wrongly flagged "page changed". `normToRaw` maps
  // each normalized index back to its offset in `flat` so the fallback still
  // builds an accurate Range. Exact matches keep the original fast path.
  let norm = null;
  let normToRaw = null;
  const buildNorm_ = () => {
    norm = '';
    normToRaw = [];
    let j = 0;
    while (j < flat.length) {
      if (/\s/.test(flat[j])) {
        const runStart = j;
        while (j < flat.length && /\s/.test(flat[j])) j++;
        if (norm.length > 0) { normToRaw.push(runStart); norm += ' '; } // collapse run; skip leading
      } else {
        normToRaw.push(j); norm += flat[j]; j++;
      }
    }
    normToRaw.push(flat.length); // sentinel so an end index maps cleanly
  };

  const tasks = [];
  const failed = [];
  for (const h of highlights) {
    const text = h.highlightedText;
    if (!text) { failed.push(h.highlightId); continue; }
    let idx = flat.indexOf(text);
    let endIdx;
    if (idx !== -1) {
      endIdx = idx + text.length;
    } else {
      if (norm === null) buildNorm_();
      const needle = text.replace(/\s+/g, ' ').trim();
      const nIdx = needle ? norm.indexOf(needle) : -1;
      if (nIdx === -1) { failed.push(h.highlightId); continue; }
      idx = normToRaw[nIdx];
      endIdx = normToRaw[nIdx + needle.length];
    }
    let startSeg = null, startOff = 0;
    let endSeg = null, endOff = 0;
    for (const s of segments) {
      if (!startSeg && idx >= s.start && idx < s.end) {
        startSeg = s;
        startOff = idx - s.start;
      }
      if (!endSeg && endIdx > s.start && endIdx <= s.end) {
        endSeg = s;
        endOff = endIdx - s.start;
      }
      if (startSeg && endSeg) break;
    }
    if (!startSeg || !endSeg) { failed.push(h.highlightId); continue; }
    try {
      const range = document.createRange();
      range.setStart(startSeg.node, startOff);
      range.setEnd(endSeg.node, endOff);
      tasks.push({ h, range });
    } catch (e) {
      failed.push(h.highlightId);
    }
  }

  const anchored = [];
  for (const t of tasks) {
    try {
      const color = colorForLabel(t.h.primaryCategory);
      wrapRangeWithMark(t.range, color, t.h.highlightId);
      anchored.push(t.h.highlightId);
    } catch (e) {
      failed.push(t.h.highlightId);
    }
  }
  // Already-anchored IDs count as anchored from the caller's perspective —
  // they shouldn't be flagged as "page changed" just because we skipped them.
  alreadyAnchored.forEach((id) => anchored.push(id));
  return { anchored, failed };
}

self.reAnchorHighlights = reAnchorHighlights;
