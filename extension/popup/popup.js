/**
 * Toolbar popup. Deliberately minimal:
 *   - Master on/off switch
 *   - Identity surface (name + email from cached 'me')
 *   - "Open my research" (the web app's all-sources page)
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
  signin: document.getElementById('signin'),
  signinTitle: document.getElementById('signin-title'),
  signinBody: document.getElementById('signin-body'),
  signinButton: document.getElementById('signin-button'),
  signinError: document.getElementById('signin-error'),
  signinAgain: document.getElementById('signin-again'),
  signinAgainButton: document.getElementById('signin-again-button'),
  lastSync: document.getElementById('last-sync'),
  enabledToggle: document.getElementById('enabled-toggle'),
  enabledLabel: document.getElementById('enabled-label'),
  teacherSection: document.getElementById('teacher-section'),
  goToProjects: document.getElementById('go-to-projects'),
  researchSection: document.getElementById('research-section'),
  version: document.getElementById('version'),
  openResearch: document.getElementById('open-research'),
};

const SYNC_STATUS_TEXT = {
  idle: 'All saved',
  syncing: 'Saving…',
  error: 'Save error — retrying',
  offline: 'Offline — saved on this device',
  needsAuth: 'Signed out',
};

// Whether this browser has ever had a working sign-in. Decides the sign-in
// card's wording: first-time setup vs. "you got signed out, here's how back".
let hadIdentity = false;

initEnabledToggle_();
bootstrapFromCache_().then(() => bootstrapFromNetwork_());

// Keep the popup live while it's open: a background drain can flip the status
// (e.g. to 'needsAuth') or a sign-in can land identity.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.syncStatus || changes.lastSyncAt) {
    getSyncStatusSafe_().then(renderSyncStatus);
  }
  if (changes.cachedMe && changes.cachedMe.newValue) {
    renderIdentity(changes.cachedMe.newValue);
  }
  // First sign-in switches the extension on (background autoEnableOnFirstSignIn_).
  if (changes.extensionEnabled) reflectEnabled_(changes.extensionEnabled.newValue === true);
});

// Master on/off switch. Single global flag in chrome.storage.local; the
// content scripts (content/enabled.js) read it and gate the toolbar + sidebar.
// Undefined = never set = OFF by default (a fresh/force install is dormant
// until the student signs in — which switches it on once — or flips it here).
async function initEnabledToggle_() {
  const { extensionEnabled } = await chrome.storage.local.get('extensionEnabled');
  reflectEnabled_(extensionEnabled === true);
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
els.version.textContent = 'Version ' + chrome.runtime.getManifest().version;

async function bootstrapFromCache_() {
  const cached = await chrome.storage.local.get(['cachedMe', 'syncStatus', 'lastSyncAt']);
  hadIdentity = !!(cached.cachedMe && cached.cachedMe.ok);
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
    // token is dead and can't be silently refreshed — show the sign-in card.
    if (refresh && /AUTH_REQUIRED/.test(refresh.error || '')) {
      renderSyncStatus({ status: 'needsAuth' });
    }
    return;
  }
  renderIdentity(refresh.me || null);
  // Signed in fine. A stale 'needsAuth' left in storage from an earlier
  // failure would otherwise keep the sign-in card up.
  const s = await getSyncStatusSafe_();
  if (s.status === 'needsAuth') {
    await chrome.storage.local.set({ syncStatus: 'idle' });
    renderSyncStatus({ status: 'idle', lastSyncAt: s.lastSyncAt });
  }
}

function renderSyncStatus(s) {
  if (!s || !s.status) return;
  els.status.className = 'sync-status sync-status--' + s.status;
  els.status.textContent = SYNC_STATUS_TEXT[s.status] || s.status;
  renderSignIn_(s.status === 'needsAuth');
  // Saves failing for another reason can still be an expired sign-in; offer
  // the low-key way back in without shouting about it.
  els.signinAgain.hidden = !['error', 'offline'].includes(s.status);
  if (s.lastSyncAt) {
    const d = new Date(s.lastSyncAt);
    els.lastSync.textContent = 'last sync ' + d.toLocaleTimeString();
  }
}

// The prominent sign-in card. Two wordings: first-time setup on a fresh
// install, and "you were signed out" for an expired sign-in — the second also
// reassures the student their unsaved work is still on this computer.
function renderSignIn_(show) {
  const wasShown = !els.signin.hidden;
  els.signin.hidden = !show;
  if (!show) {
    // Signed back in (possibly by the worker while this popup sat open):
    // replace "Not signed in" with the real identity.
    if (wasShown) {
      chrome.storage.local.get('cachedMe').then((c) => renderIdentity(c.cachedMe || null));
    }
    return;
  }
  if (hadIdentity) {
    els.signinTitle.textContent = 'You\u2019ve been signed out';
    els.signinBody.textContent =
      'Sign in again with your school Google account. Anything you highlighted ' +
      'is safe on this computer and will save as soon as you\u2019re back in.';
  } else {
    els.signinTitle.textContent = 'Sign in to get started';
    els.signinBody.textContent =
      'Use your school Google account to save your highlights and sources.';
  }
  els.name.textContent = 'Not signed in';
  els.email.textContent = '';
  els.researchSection.hidden = true;
}

function renderIdentity(meResp) {
  if (!els.signin.hidden) return; // the sign-in card owns the identity line
  if (!meResp || !meResp.ok) {
    els.name.textContent = '—';
    els.email.textContent = '';
    els.teacherSection.hidden = true;
    els.researchSection.hidden = true;
    return;
  }
  hadIdentity = true;
  const roster = meResp.roster;
  const staff = meResp.staff;
  els.researchSection.hidden = !(roster || staff);

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

// Interactive sign-in. Background drains only ever fetch tokens silently (an
// alarm has no window to show a sign-in prompt), so when the token can't be
// refreshed the queue waits at 'needsAuth' until the student clicks here.
// The background worker runs the actual flow: the Google window takes focus
// and closes this popup, and the worker is what's still around to finish.
async function signIn_() {
  els.signinButton.disabled = true;
  els.signinAgainButton.disabled = true;
  els.signinError.hidden = true;
  els.error.hidden = true;
  els.signinButton.textContent = 'Signing in\u2026';
  let r;
  try {
    r = await sendMessage({ type: 'signIn' });
  } catch (e) {
    r = { ok: false, error: e.message || String(e) };
  }
  els.signinButton.disabled = false;
  els.signinAgainButton.disabled = false;
  els.signinButton.textContent = 'Sign in with Google';
  if (!r || !r.ok) {
    renderSyncStatus({ status: 'needsAuth' });
    els.signinError.textContent = friendlySignInError_(r && r.error);
    els.signinError.hidden = false;
    return;
  }
  renderSyncStatus(await getSyncStatusSafe_());
  renderIdentity(r.me || null);
}

// Turn chrome.identity / backend errors into something a 7th grader can act on.
function friendlySignInError_(raw) {
  const msg = String(raw || '');
  if (/did not approve|cancel|closed/i.test(msg)) {
    return 'Sign-in was cancelled. Click \u201cSign in with Google\u201d to try again.';
  }
  if (/not signed in/i.test(msg)) {
    return 'Sign in to Chrome with your school account first, then try again.';
  }
  return 'Sign-in didn\u2019t work. Try again, and if it keeps happening, tell your teacher' +
    (msg ? ' (' + msg + ')' : '') + '.';
}

function getSyncStatusSafe_() {
  return sendMessage({ type: 'getSyncStatus' }).catch(() => ({ status: 'idle' }));
}

els.signinButton.addEventListener('click', signIn_);
els.signinAgainButton.addEventListener('click', signIn_);

// "My research" page, opened on the project the in-page sidebar is using. If
// the lookup fails the page falls back to the server-side active project.
els.openResearch.addEventListener('click', async () => {
  els.openResearch.disabled = true;
  let projectId = '';
  try {
    const info = await sendMessage({ type: 'getActiveProject' });
    projectId = (info && info.activeProjectId) || '';
  } catch (e) { /* open without it */ }
  const url = CONFIG.WEB_APP_URL + '?view=research'
    + (projectId ? '&projectId=' + encodeURIComponent(projectId) : '');
  chrome.tabs.create({ url });
  els.openResearch.disabled = false;
});

// Redirect teachers directly to the GAS web app projects list (WEB_APP_URL)
els.goToProjects.addEventListener('click', () => {
  chrome.tabs.create({ url: CONFIG.WEB_APP_URL });
});
