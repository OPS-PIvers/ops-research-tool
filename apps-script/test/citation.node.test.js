/**
 * Node-side unit tests for the PURE citation logic: pasted-citation override,
 * link ranges, field precedence (cleared stays cleared), bibliography sort, and
 * the "citation complete" metric.
 *
 * Loads 51_citation.js + 52_bibliography.js + 62_aggregator.js into one vm
 * context (GAS shares a global namespace the same way). Only pure functions
 * are called.
 *
 *   node apps-script/test/citation.node.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const srcDir = path.join(__dirname, '..', 'src');
const src = ['51_citation.js', '52_bibliography.js', '62_aggregator.js']
  .map((f) => fs.readFileSync(path.join(srcDir, f), 'utf8')).join('\n');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const S = sandbox;

let failures = 0;
function check(label, cond) {
  if (!cond) { failures++; console.error('  ✗ ' + label); }
  else console.log('  ✓ ' + label);
}
function eq(label, a, b) { check(label + ' (' + JSON.stringify(a) + ' == ' + JSON.stringify(b) + ')', JSON.stringify(a) === JSON.stringify(b)); }

console.log('formatCitation (built):');
{
  const out = S.formatCitation({ sourceType: 'website', title: 'Agent Orange', siteName: 'History', url: 'https://www.history.com/x' }, 'mla');
  eq('text', out.text, '"Agent Orange." History, https://www.history.com/x.');
  eq('pasted flag', out.pasted, false);
  eq('url linked, period excluded', [out.text.slice(out.links[0][0], out.links[0][1]), out.links[0][2]], ['https://www.history.com/x', 'https://www.history.com/x']);
  const book = S.formatCitation({ sourceType: 'book', title: 'Night', author: 'Elie Wiesel', url: 'https://x.org' }, 'mla');
  eq('book has no URL → no link', book.links, []);
}

console.log('formatCitation (pasted override):');
{
  const RAW = '  Spector, Ronald H.  "Vietnam War." Encyclopedia Britannica, 2024,\n www.britannica.com/event/Vietnam-War. ';
  const fields = {
    title: 'ignored', url: 'https://www.britannica.com/event/Vietnam-War',
    // Italic range is in RAW coordinates, before whitespace is collapsed.
    pasted: { text: RAW, italics: [[RAW.indexOf('Encyclopedia'), RAW.indexOf(', 2024')]] },
  };
  const out = S.formatCitation(fields, 'mla');
  eq('whitespace collapsed + trimmed', out.text, 'Spector, Ronald H. "Vietnam War." Encyclopedia Britannica, 2024, www.britannica.com/event/Vietnam-War.');
  eq('pasted flag', out.pasted, true);
  eq('italics move with collapsed whitespace', out.text.slice(out.italics[0][0], out.italics[0][1]), 'Encyclopedia Britannica');
  const l = out.links[0];
  eq('link found without https', [out.text.slice(l[0], l[1]), l[2]], ['www.britannica.com/event/Vietnam-War', 'https://www.britannica.com/event/Vietnam-War']);
  eq('blank pasted ignored', S.formatCitation({ title: 'T', pasted: { text: '   ' } }, 'mla').pasted, false);
  eq('malformed italics clamped/dropped', S.pastedCitationOf_({ pasted: { text: 'abc', italics: [[2, 99], [5, 9], 'x', [1, 1]] } }).italics, [[2, 3]]);
  eq('overlapping italics merged', S.pastedCitationOf_({ pasted: { text: 'abcdefgh', italics: [[0, 3], [2, 5]] } }).italics, [[0, 5]]);
  eq('no URL anywhere → no links', S.citationLinkRanges_('Smith. Book. 2001.', ''), []);
  const shortU = S.formatCitation({ title: 'Nation', siteName: 'history.com', url: 'history.com' }, 'mla');
  eq('URL linked at its LAST occurrence (not inside the site name)', shortU.links[0][0], shortU.text.lastIndexOf('history.com'));
  eq('non-URL-shaped url value is not linked', S.citationLinkRanges_('"Nation." a.', 'a'), []);
  eq('trailing period kept out of href', S.citationLinkRanges_('X, www.x.com/a.', 'www.x.com/a.')[0][2], 'https://www.x.com/a');
}

console.log('formatInlineCitation from a pasted citation:');
{
  eq('author last name', S.formatInlineCitation({ title: 'Civil War | Britannica', pasted: { text: 'Smith, John. "Civil War." Britannica, 2020.' } }, 'mla', ''), '(Smith)');
  eq('quoted title + page', S.formatInlineCitation({ pasted: { text: '"The Vietnam War: An Overview." History, 2020.' } }, 'mla', '12'), '("Vietnam War" 12)');
  eq('italic title', S.formatInlineCitation({ pasted: { text: 'Night. Hill and Wang, 2006.', italics: [[0, 5]] } }, 'mla', ''), '(Night)');
  eq('no paste → fields as before', S.formatInlineCitation({ author: 'Jane Doe', title: 'T' }, 'mla', ''), '(Doe)');
}

console.log('buildCitationFields_ precedence:');
{
  const src = { citationFields: JSON.stringify({ author: '' }), scrapedAuthor: 'Wrong Scrape', scrapedTitle: 'T', rawUrl: 'https://u' };
  const f = S.buildCitationFields_(src);
  eq('cleared author stays cleared', f.author, '');
  eq('unset title falls back to scrape', f.title, 'T');
  eq('unset url falls back to rawUrl', f.url, 'https://u');
  const p = S.buildCitationFields_({ citationFields: JSON.stringify({ pasted: { text: 'X.' } }) });
  check('pasted kept as an object', typeof p.pasted === 'object' && p.pasted.text === 'X.');
}

console.log('sanitizeCitationFieldsForStorage_:');
{
  const big = S.sanitizeCitationFieldsForStorage_({ title: 'T', pasted: { text: 'x'.repeat(60000) } });
  eq('huge paste clamped for storage', big.pasted.text.length, 2000);
  eq('other fields untouched', big.title, 'T');
  eq('blank paste dropped', 'pasted' in S.sanitizeCitationFieldsForStorage_({ pasted: { text: ' ' } }), false);
  eq('no paste → same object', S.sanitizeCitationFieldsForStorage_({ a: 1 }).a, 1);
}

console.log('bibSortKey_:');
{
  eq('leading quote + article stripped', S.bibSortKey_({}, '"The Vietnam War." Britannica.'), 'vietnam war." britannica.');
  eq('author last name', S.bibSortKey_({ author: 'Ronald Spector' }, ''), 'spector');
}

console.log('isCitationComplete_:');
{
  eq('title+url', S.isCitationComplete_({ title: 'a', url: 'b' }), true);
  eq('title only', S.isCitationComplete_({ title: 'a' }), false);
  eq('pasted', S.isCitationComplete_({ pasted: { text: 'Smith. Thing.' } }), true);
  eq('blank pasted', S.isCitationComplete_({ pasted: { text: ' ' } }), false);
  eq('metric uses it', S.computeCompletion_([{ citationFields: JSON.stringify({ pasted: { text: 'x' } }), primarySecondary: 'unset' }]).citation.complete, 1);
}

if (failures) { console.error('\n' + failures + ' FAILED'); process.exit(1); }
console.log('\nALL GREEN');
