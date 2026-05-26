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
};

bootstrap();

async function bootstrap() {
  renderSyncStatus(await sendMessage({ type: 'getSyncStatus' }));

  // Refresh roster + projects + bundles from the GAS. If that fails, fall
  // back to whatever's in cache from a previous successful load.
  let refresh;
  try {
    refresh = await sendMessage({ type: 'refreshContext' });
  } catch (e) {
    showError('Could not reach the backend: ' + (e.message || e));
  }

  const me = (refresh && refresh.me) || null;
  const projects = (refresh && refresh.projects && refresh.projects.projects) || [];
  const bundles = (refresh && refresh.bundles && refresh.bundles.bundles) || [];

  renderIdentity(me);

  const activeProjectId = await getActiveProjectIdFromBg_();
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
  if (!activeProjectId && projects.length > 0) {
    // First-run: stickily pick the top one and persist.
    els.select.value = projects[0].projectId;
    sendMessage({ type: 'setActiveProject', projectId: projects[0].projectId });
  }
  els.select.addEventListener('change', async () => {
    await sendMessage({ type: 'setActiveProject', projectId: els.select.value });
    const refresh = await sendMessage({ type: 'refreshContext' }).catch(() => null);
    const bundlesAfter = (refresh && refresh.bundles && refresh.bundles.bundles) || [];
    const projectsAfter = (refresh && refresh.projects && refresh.projects.projects) || projects;
    renderBundleForActive(projectsAfter, bundlesAfter, els.select.value);
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
