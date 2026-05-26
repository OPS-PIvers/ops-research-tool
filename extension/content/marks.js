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
  const textNodes = collectTextNodesInRange_(range);
  if (textNodes.length === 0) return;
  const startNode = textNodes[0];
  const endNode = textNodes[textNodes.length - 1];

  // Split boundary text nodes so we wrap exactly the selected portion.
  if (startNode === range.startContainer && range.startOffset > 0) {
    textNodes[0] = startNode.splitText(range.startOffset);
  }
  if (endNode === range.endContainer && range.endOffset < endNode.length) {
    endNode.splitText(range.endOffset);
  }

  textNodes.forEach((tn) => {
    if (!tn.textContent || !tn.parentNode) return;
    const span = document.createElement('span');
    span.className = MARK_CLASS;
    span.setAttribute(MARK_ATTR, highlightId);
    span.style.backgroundColor = color;
    span.style.borderRadius = '2px';
    tn.parentNode.insertBefore(span, tn);
    span.appendChild(tn);
  });
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
