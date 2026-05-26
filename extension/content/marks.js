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
  span.style.setProperty('background-color', color, 'important');
  span.style.setProperty('border-radius', '2px', 'important');
  span.style.setProperty('padding', '0', 'important');
  tn.parentNode.insertBefore(span, tn);
  span.appendChild(tn);
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
