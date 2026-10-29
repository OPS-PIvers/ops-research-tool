/**
 * Node-side tests for URL normalization: the extension's normalizeUrl
 * (shared/url.js) and the backend's normalizeUrl_ (apps-script/src/03_utils.js)
 * must agree, and a Gale or EBSCO article reached from two different searches
 * must be one page. Also checks that legacy rows (saved before the Gale rule) still
 * match the page and collapse in dedupeSourcesByUrl_.
 *
 *   node extension/test/url.node.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ext = { console };
ext.self = ext;
vm.createContext(ext);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'url.js'), 'utf8'), ext);

const gas = { console };
vm.createContext(gas);
const gasSrc = path.join(__dirname, '..', '..', 'apps-script', 'src');
vm.runInContext(fs.readFileSync(path.join(gasSrc, '03_utils.js'), 'utf8'), gas);
vm.runInContext(fs.readFileSync(path.join(gasSrc, '21_reads.js'), 'utf8'), gas);

let failures = 0;
function eq(label, a, b) {
  const ok = a === b;
  if (!ok) failures++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + label + (ok ? '' : '\n      got      ' + a + '\n      expected ' + b));
}

const G = 'https://go-gale-com.content.elibrarymn.org/ps/retrieve.do';
// The same article, opened from two searches a day apart (shape of the URLs
// saved by a student on 10/28 and 10/29).
const galeDay1 = G + '?tabID=FeaturedContent&resultListType=RESULT_LIST&searchResultsType=SingleTab'
  + '&retrievalId=82e6f8b7-5e9d-4438-a3b0-40f3c325d22c&hitCount=3&gtmSearchId=66464096-68a2-4693-90af-ea9321c892ce'
  + '&searchType=TopicSearchForm&currentPosition=1&docId=GALE%7CUWDXSQ579838739&docType=Topic+overview'
  + '&sort=Relevance&contentSegment=ZXBK-MOD1&pageNum=1&searchId=&inPS=true&u=mnsminitex&p=SUIC&aty=ip';
const galeDay2 = G + '?tabID=Reference&resultListType=RESULT_LIST&searchResultsType=MultiTab'
  + '&retrievalId=a3d03848-0edf-41f5-a73f-4d69dcc6f656&hitCount=48&searchType=BasicSearchForm'
  + '&currentPosition=4&docId=GALE%7CUWDXSQ579838739&searchId=R5&inPS=true&aty=ip&u=mnsminitex&p=SUIC#anchor';
const galeCanon = G + '?docId=GALE%7CUWDXSQ579838739';
const E = 'https://research-ebsco-com.content.elibrarymn.org/c/n44427/search/details/wkivqoljgb';

const cases = [
  ['strips tracking', 'https://example.com/a?utm_source=x&id=4', 'https://example.com/a?id=4'],
  ['drops fragment', 'https://example.com/a#s', 'https://example.com/a'],
  ['keeps other order', 'https://example.com/a?b=1&a=2', 'https://example.com/a?b=1&a=2'],
  ['not a url', 'not a url', 'not a url'],
  ['empty', '', ''],
  ['gale day 1 -> docId', galeDay1, galeCanon],
  ['gale day 2 -> docId', galeDay2, galeCanon],
  ['gale raw pipe in docId', G + '?docId=GALE|UWDXSQ579838739&u=x', galeCanon],
  ['gale lowercase %7c', G + '?docid=GALE%7cUWDXSQ579838739', galeCanon],
  ['go.gale.com direct', 'https://go.gale.com/ps/retrieve.do?u=x&docId=GALE%7CA1', 'https://go.gale.com/ps/retrieve.do?docId=GALE%7CA1'],
  ['gale retrieve.do without docId untouched', G + '?searchId=R5&u=x', G + '?searchId=R5&u=x'],
  ['gale bookmark link', 'https://link.gale.com/apps/doc/UWDXSQ579838739/SUIC?u=mnsminitex&sid=bookmark-SUIC&xid=8646c0e5',
    'https://link.gale.com/apps/doc/UWDXSQ579838739/SUIC'],
  ['gale i.do bookmark entry -> same docId', 'https://go-gale-com.content.elibrarymn.org/ps/i.do?v=2.1&it=r&id=GALE%7CUWDXSQ579838739&retrievalId=x&sid=bookmark-SUIC&u=mnsminitex&p=SUIC&aty=ip', galeCanon],
  ['gale i.do without id untouched', G.replace('retrieve.do', 'i.do') + '?v=2.1&u=x', G.replace('retrieve.do', 'i.do') + '?v=2.1&u=x'],
  ['ebsco viewer', 'https://research-ebsco-com.content.elibrarymn.org/c/n44427/viewer/html/wkivqoljgb', E],
  ['ebsco viewer proxyApplied', 'https://research-ebsco-com.content.elibrarymn.org/c/n44427/viewer/html/wkivqoljgb?proxyApplied=true', E],
  ['ebsco details with search state', 'https://research-ebsco-com.content.elibrarymn.org/c/n44427/search/details/wkivqoljgb?ctx=abc&db=mih&limiters=FT:Y&pos=1&q=national%20parks&searchMode=enhanced', E],
  ['ebsco details modal=cite', 'https://research-ebsco-com.content.elibrarymn.org/c/n44427/search/details/wkivqoljgb?modal=cite&q=national+parks', E],
  ['ebsco search results page untouched', 'https://research-ebsco-com.content.elibrarymn.org/c/n44427/search/results?q=parks', 'https://research-ebsco-com.content.elibrarymn.org/c/n44427/search/results?q=parks'],
  ['britannica school untouched', 'https://school-eb-com.content.elibrarymn.org/levels/high/article/titanic/72636#toc', 'https://school-eb-com.content.elibrarymn.org/levels/high/article/titanic/72636'],
  ['non-gale retrieve.do untouched', 'https://example.com/ps/retrieve.do?docId=1&x=2', 'https://example.com/ps/retrieve.do?docId=1&x=2'],
  ['"gale" inside a word is not Gale', 'https://nightingale.org/ps/retrieve.do?docId=1&x=2', 'https://nightingale.org/ps/retrieve.do?docId=1&x=2'],
];

console.log('normalizeUrl (extension):');
cases.forEach(([label, input, want]) => eq(label, ext.normalizeUrl(input), want));
console.log('normalizeUrl_ (backend) matches extension:');
cases.forEach(([label, input]) => eq(label, gas.normalizeUrl_(input), ext.normalizeUrl(input)));

console.log('legacy rows (old normalizedUrl column):');
const legacy = { sourceId: 'old', normalizedUrl: galeDay1.replace(/#.*/, ''), rawUrl: galeDay1, createdByEmail: 's@x', createdAt: '2026-10-28' };
const legacy2 = { sourceId: 'dup', normalizedUrl: galeDay2.replace(/#.*/, ''), rawUrl: galeDay2, createdByEmail: 's@x', createdAt: '2026-10-29' };
eq('extension sourcePageUrl', ext.sourcePageUrl(legacy), galeCanon);
eq('backend sourcePageUrl_', gas.sourcePageUrl_(legacy2), galeCanon);
eq('falls back to normalizedUrl', ext.sourcePageUrl({ normalizedUrl: 'https://example.com/a' }), 'https://example.com/a');

console.log('dedupeSourcesByUrl_ collapses the two Gale rows:');
{
  const out = gas.dedupeSourcesByUrl_([legacy, legacy2], [
    { highlightId: 'h1', sourceId: 'old' }, { highlightId: 'h2', sourceId: 'dup' },
  ]);
  eq('one source left', out.sources.length, 1);
  eq('oldest is canonical', out.sources[0].sourceId, 'old');
  eq('dup highlight repointed', out.highlights[1].sourceId, 'old');
  const other = gas.dedupeSourcesByUrl_([legacy, Object.assign({}, legacy2, { createdByEmail: 'm2@x' })], []);
  eq('different group members stay separate', other.sources.length, 2);
}

if (failures) { console.error('\n' + failures + ' FAILED'); process.exit(1); }
console.log('\nALL GREEN');
