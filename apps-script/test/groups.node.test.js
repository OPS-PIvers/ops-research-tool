/**
 * Node-side unit tests for the PURE group-join logic in 66_groups.js and the
 * solo-Sheet name matching in 11_provisioning.js that merge now depends on.
 *
 *   node apps-script/test/groups.node.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const srcDir = path.join(__dirname, '..', 'src');
const src = ['02_constants.js', '11_provisioning.js', '66_groups.js']
  .map((f) => fs.readFileSync(path.join(srcDir, f), 'utf8')).join('\n');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const {
  normalizeGroupJoinMode_, rowsNotYetIn_, fillBlankSourceFields_,
  soloSheetName_, soloSheetNameMatches_,
} = sandbox;

let failures = 0;
function check(label, cond) {
  if (!cond) { failures++; console.error('  ✗ ' + label); }
  else console.log('  ✓ ' + label);
}
function eq(label, a, b) { check(label + ' (' + JSON.stringify(a) + ' == ' + JSON.stringify(b) + ')', JSON.stringify(a) === JSON.stringify(b)); }

console.log('normalizeGroupJoinMode_:');
eq('fresh', normalizeGroupJoinMode_('fresh'), 'fresh');
eq('case/space-insensitive', normalizeGroupJoinMode_(' Fresh '), 'fresh');
eq('combine', normalizeGroupJoinMode_('combine'), 'combine');
eq('missing → combine (old callers)', normalizeGroupJoinMode_(undefined), 'combine');
eq('junk → combine', normalizeGroupJoinMode_('wipe'), 'combine');

console.log('rowsNotYetIn_:');
{
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'b' }, { id: '' }, { id: 'c' }];
  eq('skips existing, in-batch repeats, blank ids', rowsNotYetIn_(rows, 'id', ['c']).map((r) => r.id), ['a', 'b']);
  eq('empty existing keeps all unique', rowsNotYetIn_(rows, 'id', []).map((r) => r.id), ['a', 'b', 'c']);
  eq('second run copies nothing', rowsNotYetIn_(rows, 'id', ['a', 'b', 'c']).length, 0);
}

console.log('fillBlankSourceFields_:');
{
  const scrapeOnly = { sourceId: 's1', scrapedTitle: 'T', citationFields: '{}', primarySecondary: 'unset', annotation: '', sourceType: '' };
  const solo = { sourceId: 's1', scrapedTitle: 'old', citationFields: '{"title":"x"}', primarySecondary: 'primary', annotation: 'my note', sourceType: 'website', annotationLastEdited: '2026-10-01' };
  const m = fillBlankSourceFields_(scrapeOnly, solo);
  check('re-asserted row gets the student work back', m && m.citationFields === '{"title":"x"}' && m.primarySecondary === 'primary' && m.annotation === 'my note' && m.sourceType === 'website');
  eq('scraped fields stay the group\'s', m.scrapedTitle, 'T');
  const edited = Object.assign({}, scrapeOnly, { annotation: 'group note', primarySecondary: 'secondary' });
  const m2 = fillBlankSourceFields_(edited, solo);
  eq('never overwrites a non-blank group value (annotation)', m2.annotation, 'group note');
  eq('never overwrites a non-blank group value (classification)', m2.primarySecondary, 'secondary');
  eq('nothing to fill → null', fillBlankSourceFields_(solo, scrapeOnly), null);
}

console.log('solo-Sheet name matching (the merge-lookup bug):');
{
  const email = 'ann.lee@student.example.org';
  const name = soloSheetName_('History Day 2026', email);
  check('friendly name is NOT the bare email (why exact-name lookup missed)', name !== email);
  check('friendly name matches', soloSheetNameMatches_(name, email));
  check('legacy bare-email name matches', soloSheetNameMatches_(email, email));
  check('longer local part does not match', !soloSheetNameMatches_(soloSheetName_('P', 'jann.lee@student.example.org'), email));
  check('group sheet does not match', !soloSheetNameMatches_('[grp] Group 1', email));
}

if (failures) { console.error('\n' + failures + ' FAILED'); process.exit(1); }
console.log('\nall passed');
