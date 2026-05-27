/**
 * PDF helper banner.
 *
 * On PDF tabs, Chrome's built-in PDF viewer is sandboxed: students see
 * selectable text but our toolbar content scripts cannot hook into selection
 * events inside the embed. The only way to highlight a PDF is via the
 * extension's Tier 2 PDF.js panel (extension/pdf/panel.html). This banner
 * surfaces that path right on the PDF tab so students don't have to discover
 * the popup CTA on their own.
 *
 * Detection (any of):
 *   - document.contentType === 'application/pdf'  (most reliable)
 *   - a top-level <embed type="application/pdf"> in the outer DOM
 *   - URL path that looks like a PDF (fallback for cases where Chrome strips
 *     the contentType signal — kept narrow to avoid false positives)
 */

(function () {
  // Guard: don't double-inject on history-pushstate spas etc.
  if (window.__OPS_RESEARCH_PDF_BANNER__) return;

  if (!looksLikePdfTab_()) return;
  window.__OPS_RESEARCH_PDF_BANNER__ = true;

  // The outer DOM of a PDF tab may not have a <body> ready at document_idle
  // on all Chrome versions — be defensive.
  const inject = () => {
    if (!document.body) {
      requestAnimationFrame(inject);
      return;
    }
    document.body.appendChild(buildBanner_());
  };
  inject();

  function looksLikePdfTab_() {
    try {
      if (document.contentType === 'application/pdf') return true;
    } catch (e) { /* contentType not always defined */ }
    if (document.querySelector('embed[type="application/pdf"]')) return true;
    const path = (location.pathname || '').toLowerCase();
    if (path.endsWith('.pdf')) return true;
    return /^\/pdf\//.test(path) || /^\/doi\/pdf\//.test(path) || /^\/stable\/pdf\//.test(path);
  }

  function buildBanner_() {
    const host = document.createElement('div');
    host.id = '__ops_research_pdf_banner__';
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', 'OPS Research Tool');
    Object.assign(host.style, {
      position: 'fixed',
      top: '8px',
      right: '8px',
      zIndex: '2147483647',
      maxWidth: '320px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px',
      lineHeight: '1.4',
      color: '#202124',
      background: '#fff',
      border: '1px solid #dadce0',
      borderRadius: '8px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      padding: '10px 12px',
    });

    const title = document.createElement('div');
    title.textContent = 'OPS Research Tool';
    Object.assign(title.style, { fontWeight: '600', marginBottom: '4px' });
    host.appendChild(title);

    const msg = document.createElement('div');
    msg.textContent = "Chrome's PDF viewer blocks in-place highlighting. Open this PDF in the research panel to capture passages.";
    Object.assign(msg.style, { color: '#5f6368', marginBottom: '8px', fontSize: '12px' });
    host.appendChild(msg);

    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', gap: '6px', alignItems: 'center' });

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.textContent = 'Open in research panel';
    Object.assign(openBtn.style, {
      flex: '1',
      padding: '6px 10px',
      background: '#1a73e8',
      color: '#fff',
      border: 'none',
      borderRadius: '4px',
      fontSize: '12px',
      fontWeight: '500',
      cursor: 'pointer',
    });
    openBtn.addEventListener('click', async () => {
      openBtn.disabled = true;
      openBtn.textContent = 'Opening…';
      try {
        const resp = await chrome.runtime.sendMessage({
          type: 'openPdfPanel',
          url: location.href,
        });
        if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'open failed');
        // Banner gets torn down when this tab navigates (it won't — the
        // panel opens in a new tab), so dismiss it explicitly.
        host.remove();
      } catch (e) {
        openBtn.disabled = false;
        openBtn.textContent = 'Open in research panel';
        msg.textContent = 'Could not open the panel: ' + (e && e.message || e);
        msg.style.color = '#d93025';
      }
    });
    row.appendChild(openBtn);

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = '×';
    dismiss.title = 'Dismiss';
    Object.assign(dismiss.style, {
      width: '24px', height: '24px',
      background: 'transparent',
      border: 'none',
      color: '#5f6368',
      fontSize: '16px',
      cursor: 'pointer',
      padding: '0',
    });
    dismiss.addEventListener('click', () => host.remove());
    row.appendChild(dismiss);

    host.appendChild(row);
    return host;
  }
})();
