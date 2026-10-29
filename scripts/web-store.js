/**
 * Chrome Web Store API v2: upload a zip to an existing listing and submit it
 * for review. Used by scripts/publish-extension.js (README, "Publishing").
 * Plain fetch, no dependencies; fetch and sleep are injectable for the tests.
 */
const SECRET_NAMES = ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN', 'CWS_PUBLISHER_ID'];
const ITEM_VARIABLE = 'CWS_EXTENSION_ID';
const ENVIRONMENT = 'chrome-web-store';
const API = 'https://chromewebstore.googleapis.com';

class PublishError extends Error {}

/**
 * The secrets and listing id from the environment, or one sentence naming
 * everything that is missing. Never echoes a value.
 */
function readConfig(env) {
  const val = (n) => String(env[n] || '').trim();
  const missingSecrets = SECRET_NAMES.filter((n) => !val(n));
  const missingItem = !val(ITEM_VARIABLE);
  if (missingSecrets.length || missingItem) {
    const parts = [];
    if (missingSecrets.length) {
      parts.push('the secret' + (missingSecrets.length > 1 ? 's ' : ' ') + missingSecrets.join(', ')
        + ' to the "' + ENVIRONMENT + '" GitHub environment');
    }
    if (missingItem) parts.push('the repository variable ' + ITEM_VARIABLE);
    throw new PublishError('Publishing is not set up yet: add ' + parts.join(' and ') + ' (README, "Publishing").');
  }
  const itemId = val(ITEM_VARIABLE);
  if (!/^[a-p]{32}$/.test(itemId)) {
    throw new PublishError('The repository variable ' + ITEM_VARIABLE + ' is not a Chrome extension ID (32 letters a to p).');
  }
  const cfg = { itemId };
  SECRET_NAMES.forEach((n) => { cfg[n] = val(n); });
  return cfg;
}

async function json_(res, what) {
  const text = await res.text();
  if (!res.ok) throw new PublishError(what + ' failed (HTTP ' + res.status + '): ' + text);
  try { return JSON.parse(text); } catch (e) {
    throw new PublishError(what + ' returned something other than JSON.');
  }
}

function field_(body, key) {
  const v = body && typeof body === 'object' ? body[key] : undefined;
  return typeof v === 'string' ? v : undefined;
}

async function accessToken(cfg, fetchImpl) {
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.CWS_CLIENT_ID,
      client_secret: cfg.CWS_CLIENT_SECRET,
      refresh_token: cfg.CWS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const token = field_(await json_(res, 'Getting a Web Store access token'), 'access_token');
  if (!token) throw new PublishError('Getting a Web Store access token returned no token.');
  return token;
}

const IN_PROGRESS = ['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'];

/**
 * Uploads the zip, waits (up to 5 min) for the store to process it, checks the
 * version it read, then submits it for review. Returns the item state.
 */
async function uploadAndPublish(opts) {
  const cfg = opts.cfg;
  const fetchImpl = opts.fetchImpl || fetch;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = opts.log || console.log;

  const token = await accessToken(cfg, fetchImpl);
  const auth = { Authorization: 'Bearer ' + token };
  const item = 'publishers/' + encodeURIComponent(cfg.CWS_PUBLISHER_ID) + '/items/' + cfg.itemId;

  const uploaded = await json_(await fetchImpl(API + '/upload/v2/' + item + ':upload', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/zip' }, auth),
    body: opts.zip,
  }), 'Uploading the zip');
  let state = field_(uploaded, 'uploadState');
  let crxVersion = field_(uploaded, 'crxVersion');
  for (let i = 0; IN_PROGRESS.indexOf(state) !== -1 && i < 30; i++) {
    await sleep(10000);
    const status = await json_(await fetchImpl(API + '/v2/' + item + ':fetchStatus', { headers: auth }),
      'Checking the upload');
    state = field_(status, 'lastAsyncUploadState');
    crxVersion = crxVersion || field_(status, 'crxVersion');
  }
  if (IN_PROGRESS.indexOf(state) !== -1) {
    throw new PublishError('The Web Store was still processing the zip after 5 minutes. Submit it from the Developer Dashboard.');
  }
  if (state !== 'SUCCEEDED') {
    throw new PublishError('The Web Store did not accept the zip (upload state ' + (state || 'missing')
      + '). Its version must be higher than the one already uploaded.');
  }
  if (crxVersion !== undefined && crxVersion !== opts.version) {
    throw new PublishError('The Web Store read version ' + crxVersion + ' from the zip, expected ' + opts.version + '.');
  }
  log('Uploaded ' + opts.version + ' to ' + cfg.itemId + '.');

  const published = await json_(await fetchImpl(API + '/v2/' + item + ':publish', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
    body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH' }),
  }), 'Submitting for review');
  const itemState = field_(published, 'state') || 'unknown';
  log('Submitted ' + opts.version + ' for review (state ' + itemState + '); it goes live when the Web Store approves it.');
  return itemState;
}

module.exports = { SECRET_NAMES, ITEM_VARIABLE, ENVIRONMENT, PublishError, readConfig, accessToken, uploadAndPublish };
