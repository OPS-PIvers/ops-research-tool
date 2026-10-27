/**
 * Node-side unit tests for the pure solo-Sheet name helpers in
 * 11_provisioning.js: soloSheetEmailFromName_ (used by the dashboard's single
 * project walk) must agree with soloSheetNameMatches_ (the per-student lookup).
 *
 *   node apps-script/test/provisioning.node.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', '11_provisioning.js'), 'utf8');
const S = {};
vm.createContext(S);
vm.runInContext(src, S);

let failures = 0;
function eq(label, a, b) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) failures++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + label + ' (' + JSON.stringify(a) + ' == ' + JSON.stringify(b) + ')');
}

console.log('soloSheetEmailFromName_:');
eq('friendly name', S.soloSheetEmailFromName_('History Day - 2027 — Research — BMcCoy32@orono.k12.mn.us'), 'bmccoy32@orono.k12.mn.us');
eq('legacy bare email', S.soloSheetEmailFromName_('jo@x.org'), 'jo@x.org');
eq('group sheet', S.soloSheetEmailFromName_('[grp] Team A'), '');
eq('email not last', S.soloSheetEmailFromName_('jo@x.org notes'), '');
eq('leading @ is not an email', S.soloSheetEmailFromName_('Project — @handle'), '');

console.log('agrees with soloSheetNameMatches_:');
const names = [
  'P — Research — bob.jo@x.org', 'P — Research — jo@x.org', 'jo@x.org',
  'bob.jo@x.org', '[grp] jo', 'P — Research — JO@X.ORG',
];
['jo@x.org', 'bob.jo@x.org'].forEach((email) => {
  names.forEach((n) => {
    eq(email + ' vs "' + n + '"', S.soloSheetEmailFromName_(n) === email, S.soloSheetNameMatches_(n, email));
  });
});

if (failures) { console.error('\n' + failures + ' FAILED'); process.exit(1); }
console.log('\nALL GREEN');
