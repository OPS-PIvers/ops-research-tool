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

/**
 * Get a valid OAuth token. Try the cached/non-interactive path first; if
 * that throws (no cached token, first-ever request), fall back to the
 * interactive consent prompt exactly once.
 */
async function ensureToken_(forceInteractive) {
  if (!forceInteractive) {
    try { return await getAuthTokenAsync(false); }
    catch (_) { /* fall through to interactive */ }
  }
  return getAuthTokenAsync(true);
}

async function doFetchWithRetry({ method, body, params }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await ensureToken_(attempt === 1);
    // Belt-and-suspenders auth: Apps Script web apps redirect from
    // script.google.com → script.googleusercontent.com. Chrome strips the
    // Authorization header on cross-origin redirects, so include the token
    // as a query param too — that survives the redirect.
    const qs = new URLSearchParams(params || {});
    qs.set('access_token', token);
    const url = CONFIG.WEB_APP_URL + '?' + qs.toString();
    const init = {
      method,
      headers: { 'Authorization': 'Bearer ' + token },
      redirect: 'follow',
    };
    if (method === 'POST') {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body || {});
    }
    let resp;
    try {
      resp = await fetch(url, init);
    } catch (e) {
      throw new Error('fetch failed: ' + (e && e.message || e));
    }
    if (resp.status === 401 && attempt === 0) {
      console.warn('apiFetch: 401, invalidating token and retrying interactively');
      await invalidateAuthToken(token);
      continue;
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error('HTTP ' + resp.status + ': ' + text.slice(0, 200));
    }
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('json')) {
      const text = await resp.text().catch(() => '');
      throw new Error('Expected JSON, got ' + ct + '. First 200 chars: ' + text.slice(0, 200));
    }
    return resp.json();
  }
  throw new Error('Auth failed after interactive retry');
}

if (typeof self !== 'undefined') {
  Object.assign(self, { apiPost, apiGet, getAuthTokenAsync, invalidateAuthToken });
}
