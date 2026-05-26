/**
 * Toolbar popup. Owns:
 *   - Identity surface (name + email from cached 'me')
 *   - Project picker (lists open projects the student belongs to)
 *   - Sync status indicator
 *   - Bundle preview (5 swatches + labels of the active project)
 *
 * All API calls go through the background service worker.
 */

const els = {
  status: document.getElementById('sync-status'),
  name: document.getElementById('identity-name'),
  email: document.getElementById('identity-email'),
  select: document.getElementById('project-select'),
  bundleSection: document.getElementById('bundle-preview'),
  bundleRow: document.getElementById('bundle-preview-row'),
  error: document.getElementById('error'),
  forceDrain: document.getElementById('force-drain'),
  lastSync: document.getElementById('last-sync'),
  pdfCta: document.getElementById('pdf-cta'),
  openPdfPanel: document.getElementById('open-pdf-panel'),
};

maybeShowPdfCta_();
bootstrapFromCache_().then(() => bootstrapFromNetwork_());

async function maybeShowPdfCta_() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;
    if (!isPdfUrl_(tab.url)) return;
    els.pdfCta.hidden = false;
    els.openPdfPanel.addEventListener('click', async () => {
      els.openPdfPanel.disabled = true;
      await sendMessage({ type: 'openPdfPanel', url: tab.url });
      window.close();
    });
  } catch (e) {
    // Tab query can fail for restricted pages; just suppress CTA.
  }
}

function isPdfUrl_(url) {
  if (!url) return false;
  if (url.startsWith('file:') && url.toLowerCase().endsWith('.pdf')) return true;
  try {
    const u = new URL(url);
    if (u.pathname.toLowerCase().endsWith('.pdf')) return true;
  } catch (e) {
    // ignore
  }
  return false;
}

// Cache-first: paint whatever we have in chrome.storage immediately so the
// popup feels snappy and doesn't appear to "reload" every time. This also
// guarantees that the activeProjectId auto-set persists even if the user
// closes the popup the instant they open it.
async function bootstrapFromCache_() {
  const cached = await chrome.storage.local.get([
    'cachedMe', 'cachedProjects', 'cachedBundles', 'activeProjectId',
    'syncStatus', 'lastSyncAt',
  ]);
  renderSyncStatus({ status: cached.syncStatus || 'idle', lastSyncAt: cached.lastSyncAt || null });
  const me = cached.cachedMe || null;
  const projects = cached.cachedProjects || [];
  const bundles = cached.cachedBundles || [];
  renderIdentity(me);
  let activeProjectId = cached.activeProjectId || null;
  if (!activeProjectId && projects.length > 0) {
    activeProjectId = projects[0].projectId;
    // Persist BEFORE doing anything async, so even if the popup closes a
    // millisecond later, the value survives.
    await chrome.storage.local.set({ activeProjectId });
    // Sync to server (best-effort) so the Docs sidebar sees the same pick.
    sendMessage({ type: 'setActiveProject', projectId: activeProjectId }).catch(() => {});
  }
  renderProjectPicker(projects, activeProjectId);
  renderBundleForActive(projects, bundles, activeProjectId);
}

// Then refresh from the network in the background. Updates the UI in place
// if anything changed.
async function bootstrapFromNetwork_() {
  let refresh;
  try {
    refresh = await sendMessage({ type: 'refreshContext' });
  } catch (e) {
    showError('Could not reach the backend: ' + (e.message || e));
    return;
  }
  if (!refresh || !refresh.ok) return;
  const me = refresh.me || null;
  const projects = (refresh.projects && refresh.projects.projects) || [];
  const bundles = (refresh.bundles && refresh.bundles.bundles) || [];
  renderIdentity(me);
  let activeProjectId = (await chrome.storage.local.get('activeProjectId')).activeProjectId || null;
  // Auto-set after network refresh too. The cache-first bootstrap can't do
  // this on a fresh install because cachedProjects is still empty; the
  // network is what first delivers the project list.
  if (!activeProjectId && projects.length > 0) {
    activeProjectId = projects[0].projectId;
    await chrome.storage.local.set({ activeProjectId });
    sendMessage({ type: 'setActiveProject', projectId: activeProjectId }).catch(() => {});
  }
  renderProjectPicker(projects, activeProjectId);
  renderBundleForActive(projects, bundles, activeProjectId);
}

function renderSyncStatus(s) {
  if (!s || !s.status) return;
  els.status.className = 'sync-status sync-status--' + s.status;
  els.status.textContent = ({
    idle: 'All saved',
    syncing: 'Saving…',
    error: 'Save error — retrying',
    offline: 'Offline — saved on this device',
  })[s.status] || s.status;
  if (s.lastSyncAt) {
    const d = new Date(s.lastSyncAt);
    els.lastSync.textContent = 'last sync ' + d.toLocaleTimeString();
  }
}

function renderIdentity(meResp) {
  if (!meResp || !meResp.ok) {
    els.name.textContent = '—';
    els.email.textContent = '';
    return;
  }
  const roster = meResp.roster;
  if (roster) {
    els.name.textContent = roster.Name || meResp.actor || '';
    els.email.textContent = meResp.actor || '';
  } else {
    els.name.textContent = meResp.actor || '';
    els.email.textContent = 'not on the roster yet';
    showError('You are not on the OPS Research Tool roster. Contact your teacher to add you.');
  }
}

function renderProjectPicker(projects, activeProjectId) {
  els.select.innerHTML = '';
  if (!projects || projects.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = 'no projects available';
    els.select.appendChild(opt);
    els.select.disabled = true;
    return;
  }
  projects.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.projectId;
    opt.textContent = p.name + (p.schoolYear ? ' (' + p.schoolYear + ')' : '');
    if (p.projectId === activeProjectId) opt.selected = true;
    els.select.appendChild(opt);
  });
  els.select.disabled = false;
  // bootstrapFromCache_ already persisted the auto-select, so we don't need
  // to send setActiveProject again here.
  els.select.addEventListener('change', async () => {
    const id = els.select.value;
    // Write directly to storage so the value survives even if the popup
    // closes before the round-trip to the service worker completes.
    await chrome.storage.local.set({ activeProjectId: id });
    // Server sync so the Docs sidebar's pick matches the extension's.
    sendMessage({ type: 'setActiveProject', projectId: id }).catch(() => {});
    const cached = await chrome.storage.local.get(['cachedProjects', 'cachedBundles']);
    renderBundleForActive(cached.cachedProjects || [], cached.cachedBundles || [], id);
  });
}

function renderBundleForActive(projects, bundles, activeProjectId) {
  const project = projects.find((p) => p.projectId === activeProjectId);
  if (!project) { els.bundleSection.hidden = true; return; }
  const bundle = bundles.find((b) => b.bundleId === project.bundleId);
  if (!bundle) { els.bundleSection.hidden = true; return; }
  els.bundleSection.hidden = false;
  els.bundleRow.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const label = bundle['label' + i];
    const color = bundle['color' + i];
    if (!label) continue;
    const wrap = document.createElement('div');
    wrap.className = 'swatch';
    const c = document.createElement('div');
    c.className = 'swatch__color';
    c.style.backgroundColor = color;
    const l = document.createElement('div');
    l.textContent = label;
    wrap.appendChild(c);
    wrap.appendChild(l);
    els.bundleRow.appendChild(wrap);
  }
}

function showError(msg) {
  els.error.hidden = false;
  els.error.textContent = msg;
}

async function getActiveProjectIdFromBg_() {
  const resp = await sendMessage({ type: 'getActiveProject' }).catch(() => null);
  return resp && resp.activeProjectId || null;
}

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(resp);
    });
  });
}

els.forceDrain.addEventListener('click', async () => {
  els.forceDrain.disabled = true;
  await sendMessage({ type: 'forceDrain' }).catch(() => {});
  const s = await sendMessage({ type: 'getSyncStatus' });
  renderSyncStatus(s);
  setTimeout(() => { els.forceDrain.disabled = false; }, 1000);
});
