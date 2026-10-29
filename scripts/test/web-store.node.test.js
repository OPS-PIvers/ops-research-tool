/**
 * Node-side tests for the Web Store publish client (scripts/web-store.js),
 * against a fake fetch: the config check names what's missing without leaking
 * values, and upload -> poll -> publish runs in order and stops on failures.
 *
 *   node scripts/test/web-store.node.test.js
 */
const { readConfig, uploadAndPublish, PublishError } = require('../web-store');

let failures = 0;
function ok(label, cond, detail) {
  if (!cond) failures++;
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (cond || !detail ? '' : '\n      ' + detail));
}
function throwsWith(fn) {
  try { fn(); } catch (e) { return e; }
  return null;
}
async function rejectsWith(p) {
  try { await p; } catch (e) { return e; }
  return null;
}

const ITEM = 'goglhlpppkhiddkhgcknbiohcppgdggi';
const FULL = {
  CWS_CLIENT_ID: 'cid', CWS_CLIENT_SECRET: 'shh-secret', CWS_REFRESH_TOKEN: 'rt-secret',
  CWS_PUBLISHER_ID: 'pub', CWS_EXTENSION_ID: ITEM,
};

console.log('readConfig');
{
  const cfg = readConfig(FULL);
  ok('reads everything', cfg.itemId === ITEM && cfg.CWS_PUBLISHER_ID === 'pub');

  const e1 = throwsWith(() => readConfig(Object.assign({}, FULL, { CWS_REFRESH_TOKEN: ' ', CWS_EXTENSION_ID: '' })));
  ok('names a missing secret and the variable in one sentence',
    e1 instanceof PublishError && /CWS_REFRESH_TOKEN/.test(e1.message) && /CWS_EXTENSION_ID/.test(e1.message)
      && e1.message.split('. ').length === 1, e1 && e1.message);
  ok('never prints a secret value', e1 && !/shh-secret|cid\b/.test(e1.message));

  const e2 = throwsWith(() => readConfig({}));
  ok('all missing', e2 && /CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_PUBLISHER_ID/.test(e2.message), e2 && e2.message);

  const e3 = throwsWith(() => readConfig(Object.assign({}, FULL, { CWS_EXTENSION_ID: 'nope' })));
  ok('rejects a malformed listing id', e3 instanceof PublishError && /32 letters/.test(e3.message));
}

function fakeFetch(script) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init: init || {} });
    const step = script.shift();
    if (!step) throw new Error('unexpected fetch ' + url);
    return {
      ok: step.status === undefined || step.status < 400,
      status: step.status || 200,
      text: async () => JSON.stringify(step.body),
    };
  };
  fn.calls = calls;
  return fn;
}
const quiet = { sleep: async () => {}, log: () => {} };
const cfg = readConfig(FULL);
const zip = Buffer.from('PK');

(async () => {
  console.log('uploadAndPublish');
  {
    const f = fakeFetch([
      { body: { access_token: 'tok' } },
      { body: { uploadState: 'IN_PROGRESS' } },
      { body: { lastAsyncUploadState: 'IN_PROGRESS' } },
      { body: { lastAsyncUploadState: 'SUCCEEDED', crxVersion: '0.1.10' } },
      { body: { state: 'PENDING_REVIEW' } },
    ]);
    const state = await uploadAndPublish(Object.assign({ cfg, version: '0.1.10', zip, fetchImpl: f }, quiet));
    const urls = f.calls.map((c) => c.url);
    ok('returns the item state', state === 'PENDING_REVIEW', state);
    ok('token request uses the refresh token',
      urls[0] === 'https://oauth2.googleapis.com/token' && /grant_type=refresh_token/.test(f.calls[0].init.body));
    ok('uploads to the v2 upload URL',
      urls[1] === 'https://chromewebstore.googleapis.com/upload/v2/publishers/pub/items/' + ITEM + ':upload'
        && f.calls[1].init.headers.Authorization === 'Bearer tok' && f.calls[1].init.body === zip, urls[1]);
    ok('polls fetchStatus while in progress',
      urls[2].endsWith('/v2/publishers/pub/items/' + ITEM + ':fetchStatus') && urls[3] === urls[2]);
    ok('then publishes', urls[4].endsWith(':publish') && f.calls[4].init.method === 'POST');
  }
  {
    const f = fakeFetch([{ body: { access_token: 'tok' } }, { body: { uploadState: 'FAILED' } }]);
    const e = await rejectsWith(uploadAndPublish(Object.assign({ cfg, version: '0.1.10', zip, fetchImpl: f }, quiet)));
    ok('a failed upload stops before publish', e instanceof PublishError && f.calls.length === 2, e && e.message);
  }
  {
    const f = fakeFetch([{ body: { access_token: 'tok' } }, { body: { uploadState: 'SUCCEEDED', crxVersion: '0.1.9' } }]);
    const e = await rejectsWith(uploadAndPublish(Object.assign({ cfg, version: '0.1.10', zip, fetchImpl: f }, quiet)));
    ok('a version mismatch stops before publish', e && /0\.1\.9/.test(e.message) && f.calls.length === 2, e && e.message);
  }
  {
    const f = fakeFetch([{ status: 400, body: { error: 'invalid_grant' } }]);
    const e = await rejectsWith(uploadAndPublish(Object.assign({ cfg, version: '0.1.10', zip, fetchImpl: f }, quiet)));
    ok('a bad refresh token fails with the HTTP status', e && /HTTP 400/.test(e.message) && !/rt-secret/.test(e.message), e && e.message);
  }
  {
    const script = [{ body: { access_token: 'tok' } }, { body: { uploadState: 'IN_PROGRESS' } }];
    for (let i = 0; i < 30; i++) script.push({ body: { lastAsyncUploadState: 'IN_PROGRESS' } });
    const f = fakeFetch(script);
    const e = await rejectsWith(uploadAndPublish(Object.assign({ cfg, version: '0.1.10', zip, fetchImpl: f }, quiet)));
    ok('gives up after 30 polls', e && /5 minutes/.test(e.message) && f.calls.length === 32, e && e.message);
  }

  console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASS');
  process.exitCode = failures ? 1 : 0;
})();
