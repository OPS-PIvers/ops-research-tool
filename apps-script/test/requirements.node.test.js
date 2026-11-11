/**
 * Node-side unit tests for project requirements: parsing, validation, and the
 * completion % with Cite / Tag / Note each removable.
 *
 *   node apps-script/test/requirements.node.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const srcDir = path.join(__dirname, '..', 'src');
const files = fs.readdirSync(srcDir).filter((f) => /\.js$/.test(f) && !/^99_/.test(f)).sort();
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(files.map((f) => fs.readFileSync(path.join(srcDir, f), 'utf8')).join('\n'), sandbox);
const S = sandbox;

let failures = 0;
function check(label, cond) {
  if (!cond) { failures++; console.error('  ✗ ' + label); }
  else console.log('  ✓ ' + label);
}
const req = (o) => S.parseProjectRequirements_({ requirements: JSON.stringify(o) });

console.log('parseProjectRequirements_:');
{
  const d = S.parseProjectRequirements_({});
  check('defaults all three on', d.requireCitation === true && d.requireClassification === true && d.requireAnnotation === true);
  const r = req({ requireCitation: false, requireClassification: false });
  check('cite off', r.requireCitation === false);
  check('tag off', r.requireClassification === false);
  check('note still on', r.requireAnnotation === true);
}

console.log('validateRequirementsInput_:');
{
  const v = S.validateRequirementsInput_({ requireClassification: false });
  check('keeps tag false', v.requireClassification === false);
  check('cite defaults true', v.requireCitation === true);
  check('note defaults true', v.requireAnnotation === true);
}

console.log('computeCompletionSummary_:');
{
  const cited = JSON.stringify({ title: 'A', author: 'B', siteName: 'C', publishedDate: '2020' });   // every required website field
  const sources = [
    { sourceId: 's1', primarySecondary: 'unset',   annotation: 'n', citationFields: cited },  // cited + noted, untagged
    { sourceId: 's2', primarySecondary: 'primary', annotation: '',  citationFields: '{}' },   // tagged only
  ];
  check('all on → 0 complete', S.computeCompletionSummary_(sources, S.parseProjectRequirements_({})).complete === 0);
  check('legacy undefined reqs → 0 complete', S.computeCompletionSummary_(sources).complete === 0);
  check('tag removed → s1 complete', S.computeCompletionSummary_(sources, req({ requireClassification: false })).complete === 1);
  const tagOnly = S.computeCompletionSummary_(sources, req({ requireCitation: false, requireAnnotation: false }));
  check('only tag → s2 complete, 50%', tagOnly.complete === 1 && tagOnly.percent === 50);
  const none = S.computeCompletionSummary_(sources, req({ requireCitation: false, requireClassification: false, requireAnnotation: false }));
  check('all removed → untracked, 0%', none.tracked === false && none.percent === 0);
  const detail = S.aggregateStudentDetail_(sources, [], null, '', req({ requireCitation: false }));
  check('drill-down carries the flags', detail.requireCitation === false && detail.requireClassification === true);
}

if (failures) { console.error(failures + ' failure(s)'); process.exit(1); }
console.log('all passed');
