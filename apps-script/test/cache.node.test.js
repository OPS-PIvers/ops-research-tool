/**
 * Node-side unit tests for 05_cache.js (the CacheService read-through layer).
 *
 * CacheService / _opsExecMemo are stubbed in a vm context so the chunking,
 * memo, drop, and sheet-ref-version behaviors can be asserted without GAS.
 *
 *   node apps-script/test/cache.node.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', '05_cache.js'), 'utf8');

// In-memory CacheService stub honoring the 100KB-per-value cap.
function makeCacheStub() {
  const store = {};
  return {
    store,
    get: (k) => (k in store ? store[k] : null),
    getAll: (keys) => { const o = {}; keys.forEach((k) => { if (k in store) o[k] = store[k]; }); return o; },
    put: (k, v, ttl) => { if (String(v).length > 100 * 1024) throw new Error('too big'); store[k] = String(v); },
    putAll: (obj, ttl) => { Object.keys(obj).forEach((k) => { if (String(obj[k]).length > 100 * 1024) throw new Error('too big'); store[k] = String(obj[k]); }); },
    remove: (k) => { delete store[k]; },
    removeAll: (keys) => keys.forEach((k) => { delete store[k]; }),
  };
}

const cache = makeCacheStub();
const sandbox = {
  CacheService: { getScriptCache: () => cache },
  console,
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

let failures = 0;
function check(label, cond) {
  if (!cond) { failures++; console.error('  ✗ ' + label); }
  else console.log('  ✓ ' + label);
}

console.log('cachedJson_ miss → compute → hit:');
{
  let computes = 0;
  const v1 = sandbox.cachedJson_('t1', 60, () => { computes++; return { a: 1, when: new Date('2026-01-02T03:04:05Z') }; });
  check('first call computes', computes === 1 && v1.a === 1);
  const v2 = sandbox.cachedJson_('t1', 60, () => { computes++; return { a: 2 }; });
  check('second call served from memo (no compute)', computes === 1 && v2.a === 1);
  // Simulate a new execution: reset the memo, keep the CacheService.
  sandbox._opsExecMemo = {};
  const v3 = sandbox.cachedJson_('t1', 60, () => { computes++; return { a: 3 }; });
  check('new execution served from CacheService', computes === 1 && v3.a === 1);
  check('Date round-trips as ISO string', typeof v3.when === 'string' && v3.when.indexOf('2026-01-02') === 0);
}

console.log('cacheDrop_ invalidates memo + service:');
{
  let computes = 0;
  sandbox.cacheDrop_('t1');
  const v = sandbox.cachedJson_('t1', 60, () => { computes++; return { a: 9 }; });
  check('recomputed after drop', computes === 1 && v.a === 9);
}

console.log('chunking (> 90KB value):');
{
  const big = { rows: [] };
  for (let i = 0; i < 4000; i++) big.rows.push({ id: i, text: 'x'.repeat(50) });   // ~250KB
  const s = JSON.stringify(big);
  check('fixture exceeds one chunk', s.length > 90000);
  let computes = 0;
  sandbox._opsExecMemo = {};
  sandbox.cachedJson_('big', 60, () => { computes++; return big; });
  const head = cache.store['ops:v1:big'];
  check('head is a chunk marker', typeof head === 'string' && head.indexOf('__chunks:') === 0);
  const n = parseInt(head.slice('__chunks:'.length), 10);
  check('chunk count matches size', n === Math.ceil(s.length / 90000));
  sandbox._opsExecMemo = {};
  const back = sandbox.cachedJson_('big', 60, () => { computes++; return { rows: [] }; });
  check('reassembled from chunks without recompute', computes === 1 && back.rows.length === 4000 && back.rows[3999].id === 3999);
  // Expire one chunk → must read as a miss and recompute, never a partial value.
  delete cache.store['ops:v1:big:1'];
  sandbox._opsExecMemo = {};
  const again = sandbox.cachedJson_('big', 60, () => { computes++; return { rows: ['fresh'] }; });
  check('missing chunk → miss → recompute', computes === 2 && again.rows[0] === 'fresh');
  sandbox.cacheDrop_('big');
  check('drop removes head + chunks', !('ops:v1:big' in cache.store) && !('ops:v1:big:0' in cache.store));
}

console.log('sheet-ref version bump:');
{
  sandbox._opsExecMemo = {};
  sandbox.putCachedSheetRef_('p1', 'A@X.org', { id: 'sheet-1', kind: 'solo' });
  const hit = sandbox.getCachedSheetRef_('p1', 'a@x.org');
  check('email is case-insensitive in the key', hit && hit.id === 'sheet-1');
  const g1 = sandbox.groupsListKey_('p1');
  sandbox.bumpSheetRefVersion_();
  const miss = sandbox.getCachedSheetRef_('p1', 'a@x.org');
  check('bump invalidates the sheet ref', miss === null);
  check('bump changes the groups list key', sandbox.groupsListKey_('p1') !== g1);
  sandbox.putCachedSheetRef_('p1', 'a@x.org', { id: 'sheet-2', kind: 'group' });
  sandbox.invalidateSheetRefCache_('p1', 'a@x.org');
  check('targeted invalidate drops one ref', sandbox.getCachedSheetRef_('p1', 'a@x.org') === null);
}

console.log('CacheService unavailable → still works:');
{
  const sb2 = { CacheService: { getScriptCache: () => { throw new Error('no cache'); } }, console };
  vm.createContext(sb2);
  vm.runInContext(src, sb2);
  let computes = 0;
  const a = sb2.cachedJson_('k', 60, () => { computes++; return 1; });
  const b = sb2.cachedJson_('k', 60, () => { computes++; return 2; });
  check('memo still dedupes within the execution', a === 1 && b === 1 && computes === 1);
  sb2.bumpSheetRefVersion_();
  check('bump does not throw without a cache', true);
}

if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
console.log('\nALL GREEN');
