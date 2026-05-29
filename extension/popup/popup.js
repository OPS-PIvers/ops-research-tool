/**
 * Toolbar popup. Deliberately minimal — three things only:
 *   - Master on/off switch
 *   - Identity surface (name + email from cached 'me')
 *   - Sync status + "Sync now"
 *
 * Project selection and the category key now live in the in-page sidebar; PDF
 * capture is offered by the in-page banner (content/pdf_helper.js) on PDF tabs.
 * All API calls go through the background service worker.
 */

const els = {
  status: document.getElementById('sync-status'),
  name: document.getElementById('identity-name'),
  email: document.getElementById('identity-email'),
  error: document.getElementById('error'),
  forceDrain: document.getElementById('force-drain'),
  lastSync: document.getElementById('last-sync'),
  enabledToggle: document.getElementById('enabled-toggle'),
  enabledLabel: document.getElementById('enabled-label'),
};

initEnabledToggle_();
bootstrapFromCache_().then(() => bootstrapFromNetwork_());

// Master on/off switch. Single global flag in chrome.storage.local; the
// content scripts (content/enabled.js) read it and gate the toolbar + sidebar.
// Undefined = never set = ON by default.
async function initEnabledToggle_() {
  const { extensionEnabled } = await chrome.storage.local.get('extensionEnabled');
  reflectEnabled_(extensionEnabled !== false);
  els.enabledToggle.addEventListener('change', async () => {
    const on = els.enabledToggle.checked;
    await chrome.storage.local.set({ extensionEnabled: on });
    reflectEnabled_(on);
  });
}

function reflectEnabled_(on) {
  els.enabledToggle.checked = on;
  els.enabledLabel.textContent = on ? 'Extension on' : 'Extension off';
}

// Cache-first: paint identity + sync status from chrome.storage immediately so
// the popup feels snappy and doesn't appear to reload on every open.
async function bootstrapFromCache_() {
  const cached = await chrome.storage.local.get(['cachedMe', 'syncStatus', 'lastSyncAt']);
  renderSyncStatus({ status: cached.syncStatus || 'idle', lastSyncAt: cached.lastSyncAt || null });
  renderIdentity(cached.cachedMe || null);
}

// Then refresh from the network. This also re-warms the projects/bundles caches
// the sidebar relies on, even though the popup no longer renders them.
async function bootstrapFromNetwork_() {
  let refresh;
  try {
    refresh = await sendMessage({ type: 'refreshContext' });
  } catch (e) {
    showError('Could not reach the backend: ' + (e.message || e));
    return;
  }
  if (!refresh || !refresh.ok) return;
  renderIdentity(refresh.me || null);
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

function showError(msg) {
  els.error.hidden = false;
  els.error.textContent = msg;
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
