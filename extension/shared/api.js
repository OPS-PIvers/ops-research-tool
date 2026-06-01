/**
 * Authenticated fetch wrapper around the GAS Web App.
 *
 * Auth: chrome.identity.getAuthToken returns an OAuth access token for the
 * user's Google account (district SSO). We send it as `Authorization: Bearer`
 * on every request, and the GAS reads the caller via Session.getActiveUser().
 *
 * Used only from the background service worker — content scripts proxy
 * through chrome.runtime.sendMessage so chrome.identity stays in one place.
 *
 * Failure model — important: an Apps Script web app does NOT return a clean
 * 401 when the token is expired/invalid. It 302-redirects into the Google /
 * district SSO login chain, which (with redirect:'follow') resolves to an HTML
 * login page. So "the token is bad" shows up here as a non-JSON response, not
 * a 401. We detect that, clear the cached token, and retry SILENTLY — which
 * mints a fresh token whenever the account is still signed in (the common
 * "access token aged out over the weekend" case, which is why revisiting a
 * source after a couple idle days fetched nothing). Only when even a silent
 * refresh can't produce a working token do we raise an `authRequired` error so
 * the popup can offer an interactive "Reconnect".
 *
 * Background code NEVER runs the interactive flow — it can't show its window
 * from an alarm and would hang. And every silent-token + network step is
 * time-boxed, so a wedged getAuthToken or a login-redirect that never resolves
 * can't freeze the service worker — that hang is exactly what used to strand
 * the popup on "Saving…" forever (the drain set 'syncing' and never lived to
 * write a terminal status).
 */

const SILENT_TOKEN_TIMEOUT_MS = 15000;
const FETCH_TIMEOUT_MS = 20000;

function withTimeout_(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout: ' + label)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

/** Tagged error: a token couldn't be obtained silently — needs interactive reconnect. */
function authRequiredError_(detail) {
  const e = new Error('AUTH_REQUIRED' + (detail ? ': ' + detail : ''));
  e.authRequired = true;
  return e;
}

async function getAuthTokenAsync(interactive) {
  const p = new Promise((resolve, reject) => {
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
  // Bound only the silent path; an interactive prompt is user-paced and must
  // never be killed mid-login.
  return interactive ? p : withTimeout_(p, SILENT_TOKEN_TIMEOUT_MS, 'getAuthToken(silent)');
}

/** Revoke a token from the cache when it's known to be bad (login redirect, 401). */
async function invalidateAuthToken(token) {
  if (!token) return;
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

/** Clear every cached token. Used by the popup's interactive "Reconnect". */
async function clearAllCachedTokens() {
  return new Promise((resolve) => {
    if (chrome.identity.clearAllCachedAuthTokens) {
      chrome.identity.clearAllCachedAuthTokens(() => resolve());
    } else {
      resolve();
    }
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
  // attempt 0 uses whatever token is cached (may be stale). If the server
  // bounces it as unauthorized, we clear it and attempt 1 makes Chrome mint a
  // fresh one — still SILENTLY, so this never blocks on UI and never hangs.
  for (let attempt = 0; attempt < 2; attempt++) {
    let token;
    try {
      token = await getAuthTokenAsync(false);
    } catch (e) {
      // No silent token at all (timed out, or the account needs re-consent).
      throw authRequiredError_(e.message || String(e));
    }

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

    // Time-box the request so a login-redirect chase that never resolves (or a
    // wedged network) aborts instead of hanging the worker.
    const controller = new AbortController();
    init.signal = controller.signal;
    const killer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let resp;
    try {
      resp = await fetch(url, init);
    } catch (e) {
      clearTimeout(killer);
      // AbortError (our timeout) or a hard network failure. Transient — let the
      // queue retry later rather than declaring an auth problem.
      throw new Error('fetch failed: ' + (e && e.message || e));
    }
    clearTimeout(killer);

    const ct = resp.headers.get('content-type') || '';
    const isJson = ct.includes('json');
    // A bad token surfaces as a non-JSON body (the SSO login page) or, rarely,
    // a 401/403 — GAS never reliably returns 401, so we can't key on status.
    const authFailed = resp.status === 401 || resp.status === 403 || !isJson;

    if (authFailed && attempt === 0) {
      console.warn('[OPS] apiFetch unauthorized (status ' + resp.status + ', content-type "' + ct + '", final url ' + (resp.url || '?') + '); clearing token and retrying.');
      await invalidateAuthToken(token);
      continue; // attempt 1 mints a fresh token silently if the account is still signed in
    }
    if (authFailed) {
      await invalidateAuthToken(token);
      throw authRequiredError_('still unauthorized after refresh (status ' + resp.status + ', content-type "' + ct + '")');
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error('HTTP ' + resp.status + ': ' + text.slice(0, 200));
    }
    return resp.json();
  }
  throw authRequiredError_('auth failed after token refresh');
}

if (typeof self !== 'undefined') {
  Object.assign(self, {
    apiPost, apiGet, getAuthTokenAsync, invalidateAuthToken, clearAllCachedTokens,
  });
}
