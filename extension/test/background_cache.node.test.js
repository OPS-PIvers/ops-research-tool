/**
 * Node-side unit tests for the PURE page-view helpers in background.js:
 * overlayPendingOnData_ (offline-queue overlay), selectPageData_ (page
 * narrowing) and autoEnableOnFirstSignIn_ (storage stubbed). background.js is loaded into a vm context with the service-
 * worker globals stubbed; only the pure functions are called.
 *
 *   node extension/test/background_cache.node.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const noop = () => {};
const sandbox = {
  importScripts: noop,
  console,
  chrome: {
    runtime: { onInstalled: { addListener: noop }, onStartup: { addListener: noop }, onMessage: { addListener: noop } },
    alarms: { onAlarm: { addListener: noop }, create: noop },
    storage: { onChanged: { addListener: noop }, local: {} },
    tabs: {},
  },
  CONFIG: { DRAIN_PERIOD_MINUTES: 1, MAX_BATCH_SIZE: 50 },
  QUEUE_PREFIX: 'q:',
  PAGE_SOURCE_PREFIX: 'pageSource:',
  Map, Set, Date, JSON, Object, Array, String, Promise,
};
sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const { overlayPendingOnData_, selectPageData_ } = sandbox;

let failures = 0;
function check(label, cond) {
  if (!cond) { failures++; console.error('  ✗ ' + label); }
  else console.log('  ✓ ' + label);
}

const URL_A = 'https://example.org/a';
const snapshot = {
  sources: [
    { sourceId: 's1', normalizedUrl: URL_A, createdAt: '2026-01-02T00:00:00Z', citationFields: '{"title":"T"}', annotation: 'keep me' },
    { sourceId: 's2', normalizedUrl: 'https://example.org/b', createdAt: '2026-01-03T00:00:00Z' },
  ],
  highlights: [
    { highlightId: 'h1', sourceId: 's1', primaryCategory: 'Cause', highlightedText: 'one', note: '' },
    { highlightId: 'h2', sourceId: 's2', primaryCategory: 'Effect', highlightedText: 'two', note: '' },
  ],
};

console.log('overlayPendingOnData_:');
{
  const queue = [
    { kind: 'highlight', enqueuedAt: 2, payload: { highlightId: 'h3', sourceId: 's1', primaryCategory: 'Cause', highlightedText: 'three', projectId: 'p' } },
    { kind: 'source', enqueuedAt: 1, payload: { sourceId: 's1', normalizedUrl: URL_A, scrapedTitle: 'Fresh title', scrapedExtra: { publisher: 'X' }, projectId: 'p' } },
    { kind: 'highlight', enqueuedAt: 3, payload: { highlightId: 'h1', sourceId: 's1', primaryCategory: 'Effect', highlightedText: 'one', note: 'edited', projectId: 'p' } },
  ];
  const out = overlayPendingOnData_(snapshot, queue, true);
  check('does not mutate input', snapshot.highlights.length === 2 && snapshot.sources[0].scrapedTitle === undefined);
  check('new queued highlight added + flagged pending', out.highlights.some((h) => h.highlightId === 'h3' && h._pending === true));
  const h1 = out.highlights.find((h) => h.highlightId === 'h1');
  check('queued edit overrides server row', h1.primaryCategory === 'Effect' && h1.note === 'edited' && h1._pending === true);
  const s1 = out.sources.find((s) => s.sourceId === 's1');
  check('source merge keeps server-only fields', s1.annotation === 'keep me' && s1.citationFields === '{"title":"T"}');
  check('source merge applies queued scrape', s1.scrapedTitle === 'Fresh title');
  check('object JSON columns stringified to server shape', s1.scrapedExtra === '{"publisher":"X"}');
  const out2 = overlayPendingOnData_(snapshot, queue, false);
  check('markPending=false leaves rows unflagged', out2.highlights.every((h) => !h._pending));
}

console.log('overlayPendingOnData_ deletes:');
{
  const q = [
    { kind: 'deleteHighlight', enqueuedAt: 1, payload: { highlightId: 'h2', sourceId: 's2', cascadeSource: true, projectId: 'p' } },
  ];
  const out = overlayPendingOnData_(snapshot, q, true);
  check('highlight removed', !out.highlights.some((h) => h.highlightId === 'h2'));
  check('orphaned source cascaded away', !out.sources.some((s) => s.sourceId === 's2'));
  const q2 = [{ kind: 'deleteSource', enqueuedAt: 1, payload: { sourceId: 's1', projectId: 'p' } }];
  const out2 = overlayPendingOnData_(snapshot, q2, true);
  check('deleteSource refused while highlights reference it (orphan-safe)', out2.sources.some((s) => s.sourceId === 's1'));
  const q3 = [
    { kind: 'deleteHighlight', enqueuedAt: 1, payload: { highlightId: 'h1', sourceId: 's1', cascadeSource: false, projectId: 'p' } },
    { kind: 'deleteSource', enqueuedAt: 2, payload: { sourceId: 's1', projectId: 'p' } },
  ];
  const out3 = overlayPendingOnData_(snapshot, q3, true);
  check('deleteSource applies once its last highlight is gone', !out3.sources.some((s) => s.sourceId === 's1'));
}

console.log('selectPageData_:');
{
  const dup = {
    sources: snapshot.sources.concat([{ sourceId: 's1b', normalizedUrl: URL_A, createdAt: '2026-01-01T00:00:00Z' }]),
    highlights: snapshot.highlights.concat([{ highlightId: 'h9', sourceId: 's1b', primaryCategory: 'Cause', highlightedText: 'nine' }]),
  };
  const view = selectPageData_(dup, URL_A);
  check('only this page\'s highlights (both duplicate sources)', view.highlights.length === 2 && view.highlights.every((h) => h.sourceId === 's1' || h.sourceId === 's1b'));
  check('sourceCount counts duplicates', view.sourceCount === 2);
  check('oldest source is canonical', view.source && view.source.sourceId === 's1b');
  const none = selectPageData_(dup, 'https://example.org/none');
  check('no match → empty view', none.highlights.length === 0 && none.source === null && none.sourceCount === 0);
}

(async () => {
  console.log('autoEnableOnFirstSignIn_:');
  let store = {};
  sandbox.chrome.storage.local.get = async (k) => (k in store ? { [k]: store[k] } : {});
  sandbox.chrome.storage.local.set = async (o) => { Object.assign(store, o); };
  const me = { ok: true, actor: 'stu@orono.k12.mn.us' };
  await sandbox.autoEnableOnFirstSignIn_(me);
  check('never-set → switched on', store.extensionEnabled === true);
  store = { extensionEnabled: false };
  await sandbox.autoEnableOnFirstSignIn_(me);
  check('deliberately off → stays off', store.extensionEnabled === false);
  store = {};
  await sandbox.autoEnableOnFirstSignIn_({ ok: false });
  check('failed sign-in → untouched', !('extensionEnabled' in store));

  if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
  console.log('\nALL GREEN');
})();
