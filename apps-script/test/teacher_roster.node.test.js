/**
 * Node-side unit tests for the PURE logic in 68_teacher_roster.js (the
 * dashboard "Manage roster" modal): the authorization decision, email
 * normalization, which groups a student leaves on unenroll, and row shaping.
 *
 * Loads 02_constants.js + 61_console_api.js (composeStudentName_) +
 * 68_teacher_roster.js into one vm context. Only pure functions are called, so
 * no GAS service is ever touched.
 *
 *   node apps-script/test/teacher_roster.node.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const srcDir = path.join(__dirname, '..', 'src');
const src = ['02_constants.js', '61_console_api.js', '68_teacher_roster.js']
  .map((f) => fs.readFileSync(path.join(srcDir, f), 'utf8')).join('\n');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const { canEditClassRoster_, normalizeRosterEmail_, groupsToLeaveOnUnenroll_, shapeClassRosterRows_, ROSTER_NOT_FOUND_MSG, enrollConflictsWithOtherTeacher_ } = sandbox;

let failures = 0;
function check(label, cond) {
  if (!cond) { failures++; console.error('  ✗ ' + label); }
  else console.log('  ✓ ' + label);
}
function eq(label, a, b) { check(label + ' (' + JSON.stringify(a) + ' == ' + JSON.stringify(b) + ')', JSON.stringify(a) === JSON.stringify(b)); }

console.log('canEditClassRoster_:');
{
  const mine = { Class: 'US History P3 — Ivers', TeacherEmail: 'paul.ivers@x.org' };
  const theirs = { Class: 'Bio P1 — Smith', TeacherEmail: 'smith@x.org' };
  eq('teacher owns class', canEditClassRoster_('paul.ivers@x.org', false, mine), true);
  eq('owner match is case/space-insensitive', canEditClassRoster_('  Paul.Ivers@X.org ', false, { Class: 'c', TeacherEmail: 'PAUL.IVERS@x.org ' }), true);
  eq('teacher cannot edit another teacher\'s class', canEditClassRoster_('paul.ivers@x.org', false, theirs), false);
  eq('admin can edit any class', canEditClassRoster_('admin@x.org', true, theirs), true);
  eq('unknown class refused even for admin', canEditClassRoster_('admin@x.org', true, null), false);
  eq('blank actor never matches a blank TeacherEmail', canEditClassRoster_('', false, { Class: 'c', TeacherEmail: '' }), false);
  eq('class with no teacher refused for a teacher', canEditClassRoster_('t@x.org', false, { Class: 'c', TeacherEmail: '' }), false);
}

console.log('normalizeRosterEmail_:');
{
  eq('trims + lowercases', normalizeRosterEmail_('  Ada.Lovelace@Orono.K12.MN.us '), 'ada.lovelace@orono.k12.mn.us');
  eq('rejects blank', normalizeRosterEmail_(''), '');
  eq('rejects null', normalizeRosterEmail_(null), '');
  eq('rejects no @', normalizeRosterEmail_('ada'), '');
  eq('rejects no domain dot', normalizeRosterEmail_('ada@orono'), '');
  eq('rejects inner space', normalizeRosterEmail_('ada lovelace@x.org'), '');
}

console.log('groupsToLeaveOnUnenroll_:');
{
  const groups = [
    { groupId: 'g1', className: 'P1', memberEmails: ['ada@x.org', 'alan@x.org'] },
    { groupId: 'g2', className: 'P2', memberEmails: ['ADA@x.org', 'grace@x.org'] },
    { groupId: 'g3', className: 'P1', memberEmails: ['alan@x.org', 'grace@x.org'] },
  ];
  eq('leaves the group filed under the removed class only (still shares P2)',
    groupsToLeaveOnUnenroll_(groups, 'ada@x.org', 'P1', ['P2']).map((g) => g.groupId), ['g1']);
  eq('leaves every group when no project class remains',
    groupsToLeaveOnUnenroll_(groups, 'Ada@x.org', 'P1', []).map((g) => g.groupId), ['g1', 'g2']);
  eq('not a member → nothing', groupsToLeaveOnUnenroll_(groups, 'zed@x.org', 'P1', []), []);
  eq('handles missing inputs', groupsToLeaveOnUnenroll_(null, 'ada@x.org', 'P1', null), []);
}

console.log('shapeClassRosterRows_:');
{
  const rows = shapeClassRosterRows_([
    { First: 'Grace', Last: 'Hopper', Email: 'GRACE@x.org' },
    { First: 'Ada', Last: 'Lovelace', Email: 'ada@x.org' },
    { First: '', Last: '', Email: 'noname@x.org' },
    { First: 'Alan', Last: 'hopper', Email: 'alan@x.org' },
  ]);
  eq('sorted Last, First (case-insensitive); nameless rows last',
    rows.map((r) => r.email), ['alan@x.org', 'grace@x.org', 'ada@x.org', 'noname@x.org']);
  eq('email lowercased', rows[1].email, 'grace@x.org');
  eq('display name Last, First', rows[1].name, 'Hopper, Grace');
  eq('blank name falls back to email', rows[3].name, 'noname@x.org');
  eq('rows carry only strings (google.script.run-safe)',
    rows.every((r) => Object.keys(r).every((k) => typeof r[k] === 'string')), true);
}

console.log('not-found copy:');
eq('message matches the product copy', ROSTER_NOT_FOUND_MSG,
  'No student with that email in the district roster — ask an admin to add them.');

console.log('enrollConflictsWithOtherTeacher_:');
{
  const teacherOf = { 'A P1': 'a@x.org', 'B P2': 'b@x.org', 'A P4': 'a@x.org', 'Art': 'c@x.org' };
  const shared = [{ classes: ['A P1', 'B P2'] }];
  check('B\'s student in a shared project → refused', enrollConflictsWithOtherTeacher_('A@x.org', 'A P1', ['B P2'], shared, teacherOf) === true);
  check('other teacher\'s class but no shared project → allowed', enrollConflictsWithOtherTeacher_('a@x.org', 'A P1', ['Art'], shared, teacherOf) === false);
  check('student only in my other class → allowed', enrollConflictsWithOtherTeacher_('a@x.org', 'A P1', ['A P4'], [{ classes: ['A P1', 'A P4'] }], teacherOf) === false);
  check('unenrolled student → allowed', enrollConflictsWithOtherTeacher_('a@x.org', 'A P1', [], shared, teacherOf) === false);
}

if (failures) { console.error('\n' + failures + ' FAILED'); process.exit(1); }
console.log('\nALL GREEN');
