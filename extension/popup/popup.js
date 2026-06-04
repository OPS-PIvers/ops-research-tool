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
  reconnect: document.getElementById('reconnect'),
  lastSync: document.getElementById('last-sync'),
  enabledToggle: document.getElementById('enabled-toggle'),
  enabledLabel: document.getElementById('enabled-label'),
  teacherSection: document.getElementById('teacher-section'),
  goToProjects: document.getElementById('go-to-projects'),
};

const SYNC_STATUS_TEXT = {
  idle: 'All saved',
  syncing: 'Saving…',
  error: 'Save error — retrying',
  offline: 'Offline — saved on this device',
  needsAuth: 'Sign-in needed',
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
  if (!refresh || !refresh.ok) {
    // A failed context refresh whose error is an auth wall means the cached
    // token is dead and can't be silently refreshed — surface Reconnect.
    if (refresh && /AUTH_REQUIRED/.test(refresh.error || '')) {
      renderSyncStatus({ status: 'needsAuth' });
    }
    return;
  }
  renderIdentity(refresh.me || null);
}

function renderSyncStatus(s) {
  if (!s || !s.status) return;
  els.status.className = 'sync-status sync-status--' + s.status;
  els.status.textContent = SYNC_STATUS_TEXT[s.status] || s.status;
  // Offer the interactive reconnect whenever syncing isn't cleanly healthy.
  els.reconnect.hidden = !['needsAuth', 'error', 'offline'].includes(s.status);
  if (s.lastSyncAt) {
    const d = new Date(s.lastSyncAt);
    els.lastSync.textContent = 'last sync ' + d.toLocaleTimeString();
  }
}

function renderIdentity(meResp) {
  if (!meResp || !meResp.ok) {
    els.name.textContent = '—';
    els.email.textContent = '';
    els.teacherSection.hidden = true;
    return;
  }
  const roster = meResp.roster;
  const staff = meResp.staff;

  if (staff) {
    const roleLabel = staff.Role === 'admin' ? 'Admin' : 'Teacher';
    els.name.textContent = staff.Name || meResp.actor || '';
    els.email.textContent = `${meResp.actor || ''} (${roleLabel})`;
    els.error.hidden = true;
    els.teacherSection.hidden = false;
  } else if (roster) {
    els.name.textContent = roster.Name || meResp.actor || '';
    els.email.textContent = meResp.actor || '';
    els.teacherSection.hidden = true;
  } else {
    els.name.textContent = meResp.actor || '';
    els.email.textContent = 'not on the roster yet';
    els.teacherSection.hidden = true;
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

// Interactive re-auth. The background drain only ever fetches tokens silently
// (an alarm has no window to show a sign-in prompt), so when the account needs
// re-consent the queue stalls at 'needsAuth'. The popup IS a window with a user
// gesture, so the interactive flow can run here: clear the poisoned token, mint
// a fresh one (showing the Google/SSO window if needed), then kick a drain.
els.reconnect.addEventListener('click', async () => {
  els.reconnect.disabled = true;
  els.error.hidden = true;
  els.status.textContent = 'Signing in…';
  try {
    await clearAllCachedAuthTokens_();
    await getAuthTokenInteractive_();
  } catch (e) {
    showError('Sign-in failed: ' + (e.message || e));
    els.reconnect.disabled = false;
    renderSyncStatus({ status: 'needsAuth' });
    return;
  }
  // Fresh token is now cached extension-wide; the worker will pick it up.
  await sendMessage({ type: 'refreshContext' }).then((r) => {
    if (r && r.ok) renderIdentity(r.me || null);
  }).catch(() => {});
  await sendMessage({ type: 'forceDrain' }).catch(() => {});
  const s = await sendMessage({ type: 'getSyncStatus' });
  renderSyncStatus(s);
  els.reconnect.disabled = false;
});

function getAuthTokenInteractive_() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error((chrome.runtime.lastError && chrome.runtime.lastError.message) || 'no token'));
        return;
      }
      resolve(token);
    });
  });
}

function clearAllCachedAuthTokens_() {
  return new Promise((resolve) => {
    if (chrome.identity.clearAllCachedAuthTokens) {
      chrome.identity.clearAllCachedAuthTokens(() => resolve());
    } else {
      resolve();
    }
  });
}

// Redirect teachers directly to the GAS web app projects list (WEB_APP_URL)
els.goToProjects.addEventListener('click', () => {
  chrome.tabs.create({ url: CONFIG.WEB_APP_URL });
});
