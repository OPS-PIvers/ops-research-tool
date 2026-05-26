/**
 * Authenticated fetch wrapper around the GAS Web App.
 *
 * Auth: chrome.identity.getAuthToken returns an OAuth access token for the
 * user's Google account (district SSO). We send it as `Authorization: Bearer`
 * on every request, and the GAS reads the caller via Session.getActiveUser().
 *
 * Used only from the background service worker — content scripts proxy
 * through chrome.runtime.sendMessage so chrome.identity stays in one place.
 */

async function getAuthTokenAsync(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: !!interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(
          (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'no token'
        ));
        return;
      }
      resolve(token);
    });
  });
}

/** Revoke a token from the cache when it's known to be bad (401 etc.). */
async function invalidateAuthToken(token) {
  if (!token) return;
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

async function apiPost(body) {
  if (!CONFIG.WEB_APP_URL) throw new Error('CONFIG.WEB_APP_URL is not set — paste the /exec URL from your GAS deployment.');
  return doFetchWithRetry({ method: 'POST', body });
}

async function apiGet(params) {
  if (!CONFIG.WEB_APP_URL) throw new Error('CONFIG.WEB_APP_URL is not set — paste the /exec URL from your GAS deployment.');
  return doFetchWithRetry({ method: 'GET', params });
}

async function doFetchWithRetry({ method, body, params }) {
  let token = await getAuthTokenAsync(false).catch(() => null);
  // One retry on 401: invalidate and re-fetch interactively only if needed.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!token) token = await getAuthTokenAsync(attempt === 1);
    const url = method === 'GET' && params
      ? CONFIG.WEB_APP_URL + '?' + new URLSearchParams(params).toString()
      : CONFIG.WEB_APP_URL;
    const init = {
      method,
      headers: { 'Authorization': 'Bearer ' + token },
      // Apps Script Web Apps follow a redirect to script.googleusercontent.com —
      // the Authorization header survives because host_permissions covers both.
      redirect: 'follow',
    };
    if (method === 'POST') {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body || {});
    }
    const resp = await fetch(url, init);
    if (resp.status === 401 && attempt === 0) {
      await invalidateAuthToken(token);
      token = null;
      continue;
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
    return resp.json();
  }
  throw new Error('Auth failed after retry');
}

if (typeof self !== 'undefined') {
  Object.assign(self, { apiPost, apiGet, getAuthTokenAsync, invalidateAuthToken });
}
