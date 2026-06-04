/**
 * Node-side unit tests for the PURE logic in 40_roster_model.js.
 *
 * GAS files aren't modules; we load 02_constants.js + 40_roster_model.js into a
 * single vm context (so they share lexical scope — CLASS_STATUS etc.) and call
 * the pure functions. Only pure functions are exercised; the I/O functions are
 * defined but never called, so SpreadsheetApp/CONFIG are never touched.
 *
 *   node apps-script/test/roster_model.node.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const srcDir = path.join(__dirname, '..', 'src');
const src =
  fs.readFileSync(path.join(srcDir, '02_constants.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(srcDir, '40_roster_model.js'), 'utf8');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const { buildClassSchemaFromLegacy_, studentEligibleProjects_ } = sandbox;

let failures = 0;
function check(label, cond) {
  if (!cond) { failures++; console.error('  ✗ ' + label); }
  else console.log('  ✓ ' + label);
}
function eq(label, a, b) { check(label + ' (' + JSON.stringify(a) + ' == ' + JSON.stringify(b) + ')', JSON.stringify(a) === JSON.stringify(b)); }

console.log('buildClassSchemaFromLegacy_:');
{
  // Multi-class student + a second student; duplicate enrollment; teacher backfill.
  const rows = [
    { ID: '1', First: 'Ada', Last: 'Lovelace', Email: 'ADA@x.org', Class: 'Period 1', Teacher: 'T One', TeacherEmail: 'T1@x.org' },
    { ID: '1', First: 'Ada', Last: 'Lovelace', Email: 'ada@x.org', Class: 'Period 2', Teacher: 'T Two', TeacherEmail: 't2@x.org' },
    { ID: '1', First: 'Ada', Last: 'Lovelace', Email: 'ada@x.org', Class: 'Period 1', Teacher: '', TeacherEmail: '' }, // dup enrollment
    { ID: '2', First: 'Alan', Last: 'Turing', Email: 'alan@x.org', Class: 'Period 1', Teacher: '', TeacherEmail: '' },   // class P1 already has teacher
    { ID: '3', First: 'Grace', Last: 'Hopper', Email: 'grace@x.org', Class: 'Period 3', Teacher: '', TeacherEmail: '' }, // class with no teacher anywhere
  ];
  const out = buildClassSchemaFromLegacy_(rows);

  eq('students deduped by email (3 distinct)', out.students.map((s) => s.Email), ['ada@x.org', 'alan@x.org', 'grace@x.org']);
  eq('student email lowercased', out.students[0].Email, 'ada@x.org');
  eq('student identity kept', out.students[0], { ID: '1', First: 'Ada', Last: 'Lovelace', Email: 'ada@x.org' });

  eq('classes distinct + ordered', out.classes.map((c) => c.Class), ['Period 1', 'Period 2', 'Period 3']);
  eq('class teacher lowercased', out.classes[0].TeacherEmail, 't1@x.org');
  eq('class P2 teacher', out.classes[1].TeacherEmail, 't2@x.org');
  eq('class with no teacher is blank', out.classes[2].TeacherEmail, '');
  eq('class status active', out.classes[0].Status, 'active');

  eq('enrollments deduped (4)', out.enrollments, [
    { Email: 'ada@x.org', Class: 'Period 1' },
    { Email: 'ada@x.org', Class: 'Period 2' },
    { Email: 'alan@x.org', Class: 'Period 1' },
    { Email: 'grace@x.org', Class: 'Period 3' },
  ]);
}
{
  // Teacher backfill: first row for a class has no teacher, later one does.
  const out = buildClassSchemaFromLegacy_([
    { Email: 'a@x', Class: 'C', TeacherEmail: '' },
    { Email: 'b@x', Class: 'C', TeacherEmail: 'real@x' },
  ]);
  eq('teacher backfilled from later row', out.classes[0].TeacherEmail, 'real@x');
}
{
  // Blank email / blank class rows are skipped for their respective tables.
  const out = buildClassSchemaFromLegacy_([
    { Email: '', Class: 'C', TeacherEmail: 't@x' },     // no student, no enrollment
    { Email: 'a@x', Class: '', TeacherEmail: '' },      // student, no class/enrollment
  ]);
  eq('blank-email row adds no student', out.students.map((s) => s.Email), ['a@x']);
  eq('blank-class row adds no class beyond C', out.classes.map((c) => c.Class), ['C']);
  eq('no enrollment from blank-email or blank-class rows', out.enrollments, []);
}
{
  eq('empty input → empty trio', buildClassSchemaFromLegacy_([]), { students: [], classes: [], enrollments: [] });
  eq('null input → empty trio', buildClassSchemaFromLegacy_(null), { students: [], classes: [], enrollments: [] });
}

console.log('studentEligibleProjects_:');
{
  const projects = [
    { name: 'P', memberClasses: 'Period 1, Period 2' },
    { name: 'Q', memberClasses: 'Period 3' },
    { name: 'R', memberClasses: 'Period 2,Period 9' },
  ];
  eq('single class matches by intersection', studentEligibleProjects_(['Period 1'], projects).map((p) => p.name), ['P']);
  eq('multi-class spans projects', studentEligibleProjects_(['Period 1', 'Period 3'], projects).map((p) => p.name), ['P', 'Q']);
  eq('class in two projects', studentEligibleProjects_(['Period 2'], projects).map((p) => p.name), ['P', 'R']);
  eq('no classes → none', studentEligibleProjects_([], projects), []);
  eq('no match → none', studentEligibleProjects_(['Period 7'], projects), []);
  eq('whitespace tolerated', studentEligibleProjects_(['Period 2'], [{ name: 'W', memberClasses: '  Period 2 ' }]).map((p) => p.name), ['W']);
}

console.log(failures === 0 ? '\nALL GREEN' : `\nNOT GREEN — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
