/**
 * Editor-callable test helpers — Phase 1 sanity checks.
 * Run any of these from the Apps Script editor to exercise the backend
 * without standing up the extension. Safe on real config; writes go to
 * a "Dev" project unless you point them elsewhere.
 */

/** Create a dev project + a fake roster entry for the current owner so writes can flow. */
function devSeedDevProject() {
  const me = Session.getEffectiveUser().getEmail();

  // Add owner to the roster as a fake student (in class "DEV") if missing.
  const rosterSs = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const rosterTab = getTab_(rosterSs, TABS.ROSTER);
  if (findRowByKey_(rosterTab, HEADERS.ROSTER, 'Email', me) < 0) {
    appendRow_(rosterTab, HEADERS.ROSTER, {
      ID: '', First: 'Dev', Last: 'Owner', Email: me, Class: 'DEV',
      Teacher: 'Dev Owner', TeacherEmail: me,
    });
  }
  // Add owner to staff as admin if missing.
  const staffTab = getTab_(rosterSs, TABS.STAFF);
  if (findRowByKey_(staffTab, HEADERS.STAFF, 'Email', me) < 0) {
    appendRow_(staffTab, HEADERS.STAFF, { Name: 'Dev Owner', Email: me, Role: ROLES.ADMIN });
  }
  // Create a dev project if missing.
  const existing = listProjects_().find((p) => p.name === 'Dev Project');
  if (existing) {
    console.log('Dev Project already exists: ' + existing.projectId);
    return existing;
  }
  const bundle = listBundles_().find((b) => b.name === HISTORY_DAY_BUNDLE.name);
  if (!bundle) throw new Error('History Day bundle missing — run setup() first.');
  const project = createProject_({
    name: 'Dev Project',
    schoolYear: '2025-26',
    bundleId: bundle.bundleId,
    memberClasses: ['DEV'],
    createdBy: me,
  });
  console.log('Created Dev Project: ' + project.projectId);
  return project;
}

/**
 * Diagnostic for an empty extension project picker. Read-only; mutates nothing.
 * Logs every project (status + memberClasses), the active subset, the caller's
 * student roster entry, what the extension `projects` endpoint would return for
 * the caller, and the full roster's Email|Class so a class-string mismatch is
 * obvious. Run from the editor, then read the execution log.
 */
function devDiagnoseProjects() {
  const me = Session.getEffectiveUser().getEmail();
  const projects = listProjects_();
  console.log('=== Projects (' + projects.length + ') ===');
  projects.forEach((p) => console.log(
    [p.name, 'status=' + p.status, 'classes=[' + p.memberClasses + ']', p.schoolYear].join(' | ')
  ));
  console.log('=== Active projects: ' + listActiveProjects_().length + ' ===');

  console.log('Caller: ' + me);
  console.log('My student roster entry: ' + JSON.stringify(getStudentRosterEntry_(me)));
  console.log('Extension projects endpoint would return for me: ' +
    JSON.stringify(listActiveProjectsForStudent_(me).map((p) => p.name)));

  const roster = readAllAsObjects_(
    getTab_(SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID), TABS.ROSTER), HEADERS.ROSTER);
  console.log('=== Roster (' + roster.length + ') — Email | Class ===');
  roster.forEach((r) => console.log((r.Email || '(blank)') + ' | [' + (r.Class || '(blank)') + ']'));
}

/** Round-trip: simulate a doPost batch as the current user against the Dev Project. */
function devTestRoundTrip() {
  const project = devSeedDevProject();
  const me = Session.getEffectiveUser().getEmail();
  const sourceId = uuid_();
  const highlightId = uuid_();
  const payload = {
    postData: {
      contents: JSON.stringify({
        projectId: project.projectId,
        sources: [{
          sourceId, rawUrl: 'https://example.com/article?utm_source=foo',
          scrapedTitle: 'Example Article', scrapedSite: 'Example.com',
        }],
        highlights: [{
          highlightId, sourceId, primaryCategory: 'Background',
          highlightedText: 'this is the highlighted text',
        }],
      }),
    },
  };
  const result = handlePost_(payload);
  console.log('POST result: ' + JSON.stringify(result, null, 2));

  const readBack = handleGet_({ parameter: { action: 'mySources', projectId: project.projectId } });
  console.log('Sources read-back: ' + JSON.stringify(readBack, null, 2));
  const highlightsBack = handleGet_({ parameter: { action: 'myHighlights', projectId: project.projectId } });
  console.log('Highlights read-back: ' + JSON.stringify(highlightsBack, null, 2));

  // Idempotency: re-send the same payload, should overwrite the same rows.
  const result2 = handlePost_(payload);
  console.log('POST result (re-sent for idempotency check): ' + JSON.stringify(result2, null, 2));
  const sourcesAfter = handleGet_({ parameter: { action: 'mySources', projectId: project.projectId } });
  console.log('Sources after re-send (should still be 1): ' + (sourcesAfter.sources || []).length);
}

/** Print roster validation report. */
function devValidateRoster() {
  return validateRoster();
}

/**
 * Dump everything stored for the caller across all projects. Use to verify
 * whether saved highlights are actually on the server (vs. lost to "extension
 * context invalidated" errors when the extension was reloaded mid-session).
 */
function devDumpMyData() {
  const me = Session.getActiveUser().getEmail();
  const projects = listProjects_();
  console.log('Actor: ' + me);
  console.log('Projects (' + projects.length + '):');
  projects.forEach((p) => {
    console.log('  ' + p.projectId + ' — ' + p.name + ' [' + p.status + ']');
  });
  projects.forEach((p) => {
    const sources = readSourcesForActor_(me, p.projectId);
    const highlights = readHighlightsForActor_(me, p.projectId);
    console.log('---');
    console.log('Project: ' + p.name + '  (' + p.projectId + ')');
    console.log('  Sources (' + sources.length + '):');
    sources.forEach((s) => {
      console.log('    sourceId=' + s.sourceId
        + '  normalizedUrl=' + s.normalizedUrl
        + '  title="' + (s.scrapedTitle || '').slice(0, 60) + '"');
    });
    console.log('  Highlights (' + highlights.length + '):');
    highlights.forEach((h) => {
      console.log('    highlightId=' + h.highlightId
        + '  sourceId=' + h.sourceId
        + '  primary="' + h.primaryCategory + '"'
        + '  secondary="' + h.secondaryCategory + '"'
        + '  text="' + (h.highlightedText || '').slice(0, 50) + '"'
        + '  note="' + (h.note || '').slice(0, 30) + '"');
    });
  });
}

/** Diagnostic: confirms whether the URL constructor works in this GAS runtime. */
function devProbeUrlConstructor() {
  try {
    const u = new URL('https://example.com/test?a=1&utm_source=x#frag');
    console.log('URL constructor: works');
    console.log('  toString: ' + u.toString());
    console.log('  protocol: ' + u.protocol);
    console.log('  host: ' + u.host);
    console.log('  pathname: ' + u.pathname);
    console.log('  search: ' + u.search);
    console.log('  hash: ' + u.hash);
    console.log('  searchParams typeof: ' + typeof u.searchParams);
    if (u.searchParams && u.searchParams.forEach) {
      const entries = [];
      u.searchParams.forEach((v, k) => entries.push(k + '=' + v));
      console.log('  searchParams entries: [' + entries.join(', ') + ']');
    }
  } catch (e) {
    console.log('URL constructor: THROWS — ' + e.message);
  }
}

/** URL normalization unit checks. Logs each case + a pass/fail count. */
function devTestNormalizeUrl() {
  const cases = [
    ['https://example.com/article?utm_source=foo', 'https://example.com/article'],
    ['https://example.com/article?utm_source=foo&id=42', 'https://example.com/article?id=42'],
    ['https://example.com/article#section', 'https://example.com/article'],
    ['https://example.com/?utm_medium=x&utm_campaign=y&q=cats', 'https://example.com/?q=cats'],
    ['https://example.com/path?fbclid=abc&gclid=def', 'https://example.com/path'],
    ['https://example.com/page', 'https://example.com/page'],
    ['', ''],
    ['not a url', 'not a url'],
  ];
  let pass = 0;
  cases.forEach(([input, expected]) => {
    const got = normalizeUrl_(input);
    const ok = got === expected;
    if (ok) pass++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  in=${JSON.stringify(input)}  got=${JSON.stringify(got)}  expected=${JSON.stringify(expected)}`);
  });
  console.log(`${pass}/${cases.length} passed`);
}

/** Dedup check: two different sourceIds with the same normalized URL should be detectable via findSource. */
function devTestSourceDedup() {
  const project = devSeedDevProject();
  const url1 = 'https://example.com/dedup-test?utm_source=fb';
  const url2 = 'https://example.com/dedup-test?utm_source=tw';
  const sourceId1 = uuid_();
  // Write the first source
  handlePost_({ postData: { contents: JSON.stringify({
    projectId: project.projectId,
    sources: [{ sourceId: sourceId1, rawUrl: url1, scrapedTitle: 'Dedup Test' }],
    highlights: [],
  })}});
  // findSource for the SECOND URL — should return the FIRST source (same normalized URL)
  const lookup = handleGet_({ parameter: { action: 'findSource', projectId: project.projectId, rawUrl: url2 } });
  console.log('findSource lookup: ' + JSON.stringify(lookup, null, 2));
  const ok = lookup.source && lookup.source.sourceId === sourceId1;
  console.log(ok ? 'PASS — same normalized URL resolved to existing sourceId' : 'FAIL — should have matched the existing source');
}

/**
 * Tests sidebarDeleteSource:
 *   - deletes all highlights pointing at the target source
 *   - deletes the source row itself
 *   - leaves other sources and their highlights untouched
 *   - idempotent on a missing source (returns deletedSource:false, no throw)
 */
function devTestDeleteSource() {
  const project = devSeedDevProject();
  const me = Session.getEffectiveUser().getEmail();
  const ss = findOrCreateStudentSheet_(me, project);

  // Seed: one target source with 3 highlights + one control source with 1 highlight.
  const targetSourceId = uuid_();
  const controlSourceId = uuid_();
  const targetHl = [uuid_(), uuid_(), uuid_()];
  const controlHl = uuid_();

  upsertSource_(ss, {
    sourceId: targetSourceId, projectId: project.projectId,
    rawUrl: 'https://target.example.com/page',
    scrapedTitle: 'Target', createdByEmail: me,
  });
  upsertSource_(ss, {
    sourceId: controlSourceId, projectId: project.projectId,
    rawUrl: 'https://control.example.com/page',
    scrapedTitle: 'Control', createdByEmail: me,
  });
  targetHl.forEach((hid) => upsertHighlight_(ss, {
    highlightId: hid, sourceId: targetSourceId, projectId: project.projectId,
    primaryCategory: 'Background', highlightedText: 'target text ' + hid,
    createdByEmail: me,
  }));
  upsertHighlight_(ss, {
    highlightId: controlHl, sourceId: controlSourceId, projectId: project.projectId,
    primaryCategory: 'Background', highlightedText: 'control text',
    createdByEmail: me,
  });

  // Act.
  const result = sidebarDeleteSource(project.projectId, targetSourceId);
  console.log('Delete result: ' + JSON.stringify(result));

  // Assert response shape.
  let pass = 0, fail = 0;
  const check = (label, cond) => {
    if (cond) { pass++; console.log('PASS ' + label); }
    else      { fail++; console.log('FAIL ' + label); }
  };
  check('result.ok',                   result && result.ok === true);
  check('deletedHighlights === 3',     result && result.deletedHighlights === 3);
  check('deletedSource === true',      result && result.deletedSource === true);

  // Assert sheet state.
  const sourcesAfter    = readSourcesForActor_(me, project.projectId);
  const highlightsAfter = readHighlightsForActor_(me, project.projectId);
  check('target source row gone',       !sourcesAfter.find((s) => s.sourceId === targetSourceId));
  check('control source row present',   !!sourcesAfter.find((s) => s.sourceId === controlSourceId));
  check('zero highlights for target',   highlightsAfter.filter((h) => h.sourceId === targetSourceId).length === 0);
  check('control highlight present',    !!highlightsAfter.find((h) => h.highlightId === controlHl));

  // Idempotency: deleting again should not throw.
  const result2 = sidebarDeleteSource(project.projectId, targetSourceId);
  console.log('Re-delete result: ' + JSON.stringify(result2));
  check('idempotent ok',                result2 && result2.ok === true);
  check('idempotent deletedHighlights', result2 && result2.deletedHighlights === 0);
  check('idempotent deletedSource',     result2 && result2.deletedSource === false);

  console.log(pass + '/' + (pass + fail) + ' passed');
}

/**
 * Tests aggregator pure functions with hand-crafted source/highlight data.
 * Asserts categoryMix preserves bundle order, gaps + completion counts are
 * correct, and lastActivity is the latest createdAt across both arrays.
 */
function devTestAggregateStudent() {
  const bundle = {
    bundleId: 'b-test',
    name: 'Test Bundle',
    style: 'mla',
    label1: 'Background',     color1: '#d62728',
    label2: 'Build-Up',       color2: '#ff7f0e',
    label3: 'Main Event',     color3: '#2ca02c',
    label4: 'Short-Term Impact', color4: '#1f77b4',
    label5: 'Long-Term Impact',  color5: '#9467bd',
  };
  const sources = [
    {
      sourceId: 's1', primarySecondary: 'primary', annotation: 'Good source.',
      citationFields: JSON.stringify({ title: 'A', url: 'https://a' }),
      createdAt: '2026-05-20T10:00:00Z',
    },
    {
      sourceId: 's2', primarySecondary: 'secondary', annotation: '',
      citationFields: JSON.stringify({ title: 'B', url: 'https://b' }),
      createdAt: '2026-05-21T10:00:00Z',
    },
    {
      sourceId: 's3', primarySecondary: 'unset', annotation: 'Notes.',
      citationFields: JSON.stringify({ title: '', url: '' }),
      createdAt: '2026-05-22T10:00:00Z',
    },
  ];
  const highlights = [
    { sourceId: 's1', primaryCategory: 'Background',   createdAt: '2026-05-20T11:00:00Z' },
    { sourceId: 's1', primaryCategory: 'Background',   createdAt: '2026-05-20T11:05:00Z' },
    { sourceId: 's2', primaryCategory: 'Main Event',   createdAt: '2026-05-21T11:00:00Z' },
    { sourceId: 's3', primaryCategory: 'Background',   createdAt: '2026-05-23T08:00:00Z' },
    { sourceId: 's3', primaryCategory: 'Long-Term Impact', createdAt: '2026-05-23T08:30:00Z' },
  ];

  const agg = aggregateStudent_(sources, highlights, bundle);

  let pass = 0, fail = 0;
  const check = (label, cond) => {
    if (cond) { pass++; console.log('PASS ' + label); }
    else      { fail++; console.log('FAIL ' + label); }
  };

  // categoryMix preserves bundle order
  check('mix length 5',                     agg.categoryMix.length === 5);
  check('mix[0] is Background',             agg.categoryMix[0].label === 'Background');
  check('mix[0] count = 3',                 agg.categoryMix[0].count === 3);
  check('mix[1] is Build-Up, count 0',      agg.categoryMix[1].label === 'Build-Up' && agg.categoryMix[1].count === 0);
  check('mix[2] is Main Event, count 1',    agg.categoryMix[2].label === 'Main Event' && agg.categoryMix[2].count === 1);
  check('mix[4] is Long-Term Impact, ct 1', agg.categoryMix[4].label === 'Long-Term Impact' && agg.categoryMix[4].count === 1);

  // counts
  check('sourceCount = 3',                  agg.sourceCount === 3);
  check('highlightCount = 5',               agg.highlightCount === 5);

  // completion: only s1 has all three (citation+class+annotation). s2 missing annotation. s3 missing citation+classification.
  check('completion.complete = 1',          agg.completion.complete === 1);
  check('completion.total = 3',             agg.completion.total === 3);
  check('completion.percent = 33',          agg.completion.percent === 33);

  // gaps: citation missing on s3 only (s1, s2 have title+url) → 1
  //       classification missing on s3 only → 1
  //       annotation missing on s2 only (empty string) → 1
  check('gaps.citation = 1',                agg.gaps.citation === 1);
  check('gaps.classification = 1',          agg.gaps.classification === 1);
  check('gaps.annotation = 1',              agg.gaps.annotation === 1);

  // lastActivity = latest of any createdAt across sources+highlights
  check('lastActivity = 2026-05-23T08:30:00Z', agg.lastActivity === '2026-05-23T08:30:00Z');

  console.log(pass + '/' + (pass + fail) + ' passed');
}

/**
 * Tests consoleGetContext + assertStaff_ behavior.
 * Note: this test uses the caller's real identity. The dev-seed harness
 * adds the caller to the Staff sheet as admin, so the "is staff" branch
 * is what we can directly assert. We assert the structural shape too.
 */
function devTestConsoleAuth() {
  devSeedDevProject();   // ensures caller is staff + admin
  const ctx = consoleGetContext();

  let pass = 0, fail = 0;
  const check = (label, cond) => {
    if (cond) { pass++; console.log('PASS ' + label); }
    else      { fail++; console.log('FAIL ' + label); }
  };

  check('ctx.ok',                       ctx && ctx.ok === true);
  check('actor is the caller email',    ctx.actor === Session.getEffectiveUser().getEmail());
  check('staff entry present',          !!ctx.staff);
  check('role is admin',                ctx.role === 'admin');
  check('teacherClasses is null (admin)', ctx.teacherClasses === null);

  // assertStaff_ for the caller should NOT throw.
  let throwsForStaff = false;
  try { assertStaff_(ctx.actor); } catch (e) { throwsForStaff = true; }
  check('assertStaff_ does not throw for staff', !throwsForStaff);

  // assertStaff_ for a definitely-not-staff email SHOULD throw.
  let throwsForRando = false;
  try { assertStaff_('definitely-not-staff@example.com'); } catch (e) { throwsForRando = true; }
  check('assertStaff_ throws for non-staff', throwsForRando);

  console.log(pass + '/' + (pass + fail) + ' passed');
}

/**
 * Tests role-based project filtering in consoleGetMyProjects.
 *
 * The caller is always admin (per devSeedDevProject), so we can directly
 * exercise the admin branch and the teacher branch via a temporary
 * roster manipulation: temporarily remove the caller from the Staff
 * sheet and check that consoleGetMyProjects throws.
 */
function devTestConsoleProjectsFilter() {
  devSeedDevProject();
  const me = Session.getEffectiveUser().getEmail();

  let pass = 0, fail = 0;
  const check = (label, cond) => {
    if (cond) { pass++; console.log('PASS ' + label); }
    else      { fail++; console.log('FAIL ' + label); }
  };

  // Admin sees Dev Project in the active filter.
  const adminResp = consoleGetMyProjects('active');
  check('admin: resp.ok',          adminResp && adminResp.ok === true);
  check('admin: ≥1 project',       adminResp.projects.length >= 1);
  const dev = adminResp.projects.find((p) => p.name === 'Dev Project');
  check('admin: Dev Project visible', !!dev);
  if (dev) {
    check('admin: scopedClasses includes DEV', dev.scopedClasses.indexOf('DEV') >= 0);
    check('admin: studentCount ≥1',            dev.studentCount >= 1);
    check('admin: bundleName non-empty',       !!dev.bundleName);
  }

  // Archived filter — Dev Project is active, so it should NOT appear.
  const arch = consoleGetMyProjects('archived');
  check('archived: resp.ok',                 arch && arch.ok === true);
  const devInArchived = arch.projects.find((p) => p.name === 'Dev Project');
  check('archived: Dev Project NOT visible', !devInArchived);

  // Non-staff lockout — temporarily remove the caller from Staff and re-test.
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const staffTab = getTab_(ss, TABS.STAFF);
  const rowIdx = findRowByKey_(staffTab, HEADERS.STAFF, 'Email', me);
  let removedRow = null;
  if (rowIdx >= 0) {
    removedRow = staffTab.getRange(rowIdx, 1, 1, HEADERS.STAFF.length).getValues()[0];
    staffTab.deleteRow(rowIdx);
  }
  let throws = false;
  try { consoleGetMyProjects('active'); } catch (e) { throws = true; }
  check('non-staff: endpoint throws', throws);

  // Restore the staff row.
  if (removedRow) {
    appendRow_(staffTab, HEADERS.STAFF, rowToObj_(HEADERS.STAFF, removedRow));
  }

  console.log(pass + '/' + (pass + fail) + ' passed');
}

/**
 * Tests consoleCreateProject end-to-end:
 *   - validates required fields
 *   - rejects unknown bundle
 *   - creates a project that lands in listProjects_
 *   - the project comes back from consoleGetMyProjects
 *   - archive/unarchive flips status correctly
 *
 * Cleans up by archiving the created project at the end.
 */
function devTestConsoleCreateProject() {
  devSeedDevProject();
  const bundle = listBundles_()[0];
  if (!bundle) throw new Error('No bundle seeded — run setup()');

  let pass = 0, fail = 0;
  const check = (label, cond) => {
    if (cond) { pass++; console.log('PASS ' + label); }
    else      { fail++; console.log('FAIL ' + label); }
  };

  // Validation: empty name
  let threw = false;
  try { consoleCreateProject({ name: '', schoolYear: '2026-27', bundleId: bundle.bundleId, memberClasses: ['DEV'] }); }
  catch (e) { threw = true; }
  check('empty name throws', threw);

  // Validation: zero classes
  threw = false;
  try { consoleCreateProject({ name: 'X', schoolYear: '2026-27', bundleId: bundle.bundleId, memberClasses: [] }); }
  catch (e) { threw = true; }
  check('zero classes throws', threw);

  // Validation: unknown bundle
  threw = false;
  try { consoleCreateProject({ name: 'X', schoolYear: '2026-27', bundleId: 'b-doesnt-exist', memberClasses: ['DEV'] }); }
  catch (e) { threw = true; }
  check('unknown bundle throws', threw);

  // Happy path
  const created = consoleCreateProject({
    name: 'devTest Project ' + Date.now(),
    schoolYear: '2026-27',
    bundleId: bundle.bundleId,
    memberClasses: ['DEV'],
  });
  check('create returned ok',         created && created.ok === true);
  check('create returned a projectId', !!(created.project && created.project.projectId));
  const newId = created.project.projectId;

  // Verify it lands in the registry
  const fromRegistry = getProject_(newId);
  check('project found in registry',  !!fromRegistry);
  check('status is active',           fromRegistry && fromRegistry.status === PROJECT_STATUS.ACTIVE);

  // Verify it shows up in consoleGetMyProjects (admin)
  const list = consoleGetMyProjects('active');
  const found = list.projects.find((p) => p.projectId === newId);
  check('list includes new project',  !!found);
  check('list entry has bundleName',  found && !!found.bundleName);

  // Archive
  const archResp = consoleArchiveProject(newId);
  check('archive returned ok',        archResp && archResp.ok === true);
  const afterArch = getProject_(newId);
  check('status now archived',        afterArch && afterArch.status === PROJECT_STATUS.ARCHIVED);

  // Unarchive
  const unArchResp = consoleUnarchiveProject(newId);
  check('unarchive returned ok',      unArchResp && unArchResp.ok === true);
  const afterUn = getProject_(newId);
  check('status active again',        afterUn && afterUn.status === PROJECT_STATUS.ACTIVE);

  // Final cleanup: archive again so the test project doesn't litter the registry
  consoleArchiveProject(newId);

  console.log(pass + '/' + (pass + fail) + ' passed');
}

/**
 * Seeds 2 students with different activity patterns in the Dev Project,
 * then calls consoleGetProjectDashboard and asserts the aggregates land
 * with the expected per-student shapes.
 *
 * The "test students" use the caller's email + unique sourceIds so they
 * land in the caller's own student sheet — devSeedDevProject already
 * sets the caller up in class "DEV".
 */
function devTestConsoleDashboardEndToEnd() {
  const project = devSeedDevProject();
  const me = Session.getEffectiveUser().getEmail();
  const ss = findOrCreateStudentSheet_(me, project);
  const bundle = listBundles_().find((b) => b.bundleId === project.bundleId);
  if (!bundle) throw new Error('Bundle missing — run setup()');

  // Seed a fresh source + 3 highlights in different categories.
  const sourceId = uuid_();
  upsertSource_(ss, {
    sourceId, projectId: project.projectId,
    rawUrl: 'https://devtest.example.com/' + sourceId,
    scrapedTitle: 'devTest Source',
    primarySecondary: 'primary',
    annotation: 'devTest annotation.',
    citationFields: JSON.stringify({
      title: 'devTest Source',
      url: 'https://devtest.example.com/' + sourceId,
    }),
    createdByEmail: me,
  });
  const cats = [bundle.label1, bundle.label2, bundle.label1];   // 2 in cat1, 1 in cat2
  cats.forEach((label) => upsertHighlight_(ss, {
    highlightId: uuid_(), sourceId, projectId: project.projectId,
    primaryCategory: label,
    highlightedText: 'devTest highlight in ' + label,
    createdByEmail: me,
  }));

  // Act.
  const resp = consoleGetProjectDashboard(project.projectId);

  let pass = 0, fail = 0;
  const check = (label, cond) => {
    if (cond) { pass++; console.log('PASS ' + label); }
    else      { fail++; console.log('FAIL ' + label); }
  };

  check('resp.ok',                         resp && resp.ok === true);
  check('project shape returned',          !!resp.project);
  check('asOf present',                    !!resp.asOf);
  check('students is an array',            Array.isArray(resp.students));
  check('≥1 student returned',             resp.students.length >= 1);

  const meRow = resp.students.find((s) => s.email === me);
  check('caller appears as a student',     !!meRow);
  if (meRow) {
    check('meRow.categoryMix length 5',    meRow.categoryMix && meRow.categoryMix.length === 5);
    // The devTest source contributes 2 highlights in cat1 + 1 in cat2.
    // Earlier devTestRoundTrip / devTestSourceDedup may have seeded other
    // highlights — assert that meRow.categoryMix[0].count ≥ 2.
    check('cat1 count ≥ 2',                meRow.categoryMix[0].count >= 2);
    check('cat2 count ≥ 1',                meRow.categoryMix[1].count >= 1);
    check('sourceCount ≥ 1',               meRow.sourceCount >= 1);
    check('highlightCount ≥ 3',            meRow.highlightCount >= 3);
    check('completion shape correct',      meRow.completion && typeof meRow.completion.percent === 'number');
    check('gaps shape correct',            meRow.gaps && typeof meRow.gaps.citation === 'number');
    check('lastActivity present',          !!meRow.lastActivity);
  }

  console.log(pass + '/' + (pass + fail) + ' passed');
}

// ============================================================
// Sub-project C: admin area + lifecycle
// ============================================================

/**
 * Verifies that every admin* endpoint rejects non-admin callers.
 *
 * Approach: stash the actor's true row, demote them to teacher, run
 * every endpoint, expect each to throw 'Admin only', restore the actor.
 * Editor-only because we need a real Session.getActiveUser context.
 */
function devTestAdminAuthGate() {
  const checks = [];
  const check = (label, ok) => { checks.push({ label, ok }); };

  const actor = getActorEmail_();
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.STAFF);
  const rowIdx = findRowByKeyCi_(tab, HEADERS.STAFF, 'Email', actor);
  if (rowIdx < 0) {
    console.log('devTestAdminAuthGate skipped — actor not in Staff sheet');
    return { ok: false, reason: 'actor not in Staff' };
  }
  // Add a second admin so we don't trigger the last-admin guard mid-test.
  adminAddStaffRow({Name: 'Backup Admin', Email: 'backup.admin@orono.k12.mn.us', Role: 'admin'});

  // Demote.
  const roleCol = HEADERS.STAFF.indexOf('Role') + 1;
  tab.getRange(rowIdx, roleCol).setValue(ROLES.TEACHER);

  const endpoints = [
    () => adminGetRoster(),
    () => adminAddRosterRow({First:'X', Last:'Y', Email:'x@orono.k12.mn.us', Class:'X', TeacherEmail:actor}),
    () => adminUpdateRosterRow('any@orono.k12.mn.us', {First:'X'}),
    () => adminChangeStudentEmail('a@orono.k12.mn.us', 'b@orono.k12.mn.us'),
    () => adminDeleteRosterRow('any@orono.k12.mn.us'),
    () => adminGetStaff(),
    () => adminListArchivableYears(),
    () => adminPreviewArchiveYear('any'),
  ];
  endpoints.forEach((fn, i) => {
    try { fn(); check('endpoint ' + i + ' should have thrown', false); }
    catch (e) { check('endpoint ' + i + ' rejected: ' + e.message, String(e.message).indexOf('Admin only') >= 0); }
  });

  // Restore.
  tab.getRange(rowIdx, roleCol).setValue(ROLES.ADMIN);
  adminDeleteStaffRow('backup.admin@orono.k12.mn.us');

  const pass = checks.every((c) => c.ok);
  console.log(JSON.stringify({ ok: pass, checks }, null, 2));
  return { ok: pass };
}

/**
 * Roster CRUD: add, update, set ID, change ID, delete. Cleans up after itself.
 */
function devTestAdminRosterCrud() {
  const checks = [];
  const check = (label, ok) => { checks.push({ label, ok }); };
  const e = 'crud.probe@orono.k12.mn.us';

  const added = adminAddRosterRow({First:'Crud', Last:'Probe', Email:e, Class:'PROBE', TeacherEmail: getActorEmail_()});
  check('added.ok', added.ok === true);
  check('added.row.Email', added.row.Email === e);

  const updated = adminUpdateRosterRow(e, {First: 'CrudUpdated'});
  check('updated.ok', updated.ok === true);
  check('updated.First', updated.row.First === 'CrudUpdated');

  const ided = adminSetStudentId(e, 'CRUD-001');
  check('set id ok', ided.ok === true);
  check('id stored', ided.row.ID === 'CRUD-001');

  try { adminSetStudentId(e, 'CRUD-002'); check('refused second set', false); }
  catch (err) { check('refused second set', String(err.message).indexOf('already set') >= 0); }

  const changed = adminChangeStudentId(e, 'CRUD-999');
  check('change id ok', changed.ok === true);
  check('changed id', changed.row.ID === 'CRUD-999');

  const deleted = adminDeleteRosterRow(e);
  check('deleted.ok', deleted.ok === true);

  // Verify the row is gone.
  const r = adminGetRoster();
  check('row removed', !r.rows.find((x) => x.Email === e));

  const pass = checks.every((c) => c.ok);
  console.log(JSON.stringify({ ok: pass, checks }, null, 2));
  return { ok: pass };
}

/**
 * Bulk replace: snapshot current → replace with a small set → assert
 * shape → restore. Never leaves the roster in a broken state even on
 * test failure (cleanup runs regardless via try/finally).
 */
function devTestAdminRosterReplace() {
  const checks = [];
  const check = (label, ok) => { checks.push({ label, ok }); };

  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.STAFF);
  const before = readAllAsObjects_(getTab_(ss, TABS.ROSTER), HEADERS.ROSTER);
  const tester = getActorEmail_();
  try {
    const sample = [
      {ID:'R1', First:'Replace', Last:'One',   Email:'r1@orono.k12.mn.us', Class:'PROBE', Teacher:'Paul', TeacherEmail: tester},
      {ID:'R2', First:'Replace', Last:'Two',   Email:'r2@orono.k12.mn.us', Class:'PROBE', Teacher:'Paul', TeacherEmail: tester},
      {ID:'R3', First:'Replace', Last:'Three', Email:'r3@orono.k12.mn.us', Class:'PROBE', Teacher:'Paul', TeacherEmail: tester},
    ];
    const preview = adminPreviewReplaceRoster(sample);
    check('preview ok', preview.ok === true);
    check('preview no errors', preview.errors.length === 0);
    check('preview added 3', preview.added === 3);
    const replaced = adminReplaceRoster(sample);
    check('replaced ok', replaced.ok === true);
    const after = adminGetRoster();
    check('roster has 3 rows', after.rows.length === 3);
    check('roster includes r2', !!after.rows.find((r) => r.Email === 'r2@orono.k12.mn.us'));
  } finally {
    // Restore — always runs.
    adminReplaceRoster(before.map((r) => ({
      ID: r.ID, First: r.First, Last: r.Last, Email: r.Email,
      Class: r.Class, Teacher: r.Teacher, TeacherEmail: r.TeacherEmail,
    })));
  }

  const pass = checks.every((c) => c.ok);
  console.log(JSON.stringify({ ok: pass, checks }, null, 2));
  return { ok: pass };
}

/**
 * Atomic email change: stand up a student + per-student Sheet + scratch
 * pref → rename → assert all five places updated → cleanup.
 */
function devTestAdminEmailChange() {
  const checks = [];
  const check = (label, ok) => { checks.push({ label, ok }); };
  const dev = devSeedDevProject();
  const oldE = 'rename.old@orono.k12.mn.us';
  const newE = 'rename.new@orono.k12.mn.us';

  adminAddRosterRow({First:'Rename', Last:'Probe', Email:oldE, Class:'DEV', Teacher:'Paul', TeacherEmail: getActorEmail_()});
  // Provision Sheet + populate one source + one highlight with createdByEmail=oldE.
  const sheet = findOrCreateStudentSheet_(oldE, dev);
  upsertSource_(sheet, {
    sourceId: 'rename-src',
    projectId: dev.projectId,
    normalizedUrl: 'https://example.com/rename',
    rawUrl: 'https://example.com/rename',
    accessDate: nowIso_(),
    scrapedTitle: 'Rename probe',
    sourceType: 'website',
    createdByEmail: oldE,
    createdAt: nowIso_(),
  });
  upsertHighlight_(sheet, {
    highlightId: 'rename-hl',
    sourceId: 'rename-src',
    projectId: dev.projectId,
    primaryCategory: 'Background',
    highlightedText: 'rename test',
    createdByEmail: oldE,
    createdAt: nowIso_(),
  });
  setUserPref_(oldE, 'activeProjectId', dev.projectId);

  const result = adminChangeStudentEmail(oldE, newE);
  check('result.ok', result.ok === true);
  check('renamedSheets >= 1', result.renamedSheets >= 1);
  check('rewrittenCells >= 3', result.rewrittenCells >= 3);   // Meta + Sources + Highlights
  check('rekeyedPrefs === 1', result.rekeyedPrefs === 1);

  // Confirm Sheet file rename.
  const found = findStudentSheetsForEmail_(newE);
  check('new email has Sheet', found.length === 1);

  // Confirm pref carried over.
  check('pref carried over', getUserPref_(newE, 'activeProjectId') === dev.projectId);
  check('old pref gone',     getUserPref_(oldE, 'activeProjectId') === null);

  // Cleanup.
  adminDeleteRosterRow(newE);
  setUserPref_(newE, 'activeProjectId', '');
  // Sheet file is preserved (intended); ok for dev junk.

  const pass = checks.every((c) => c.ok);
  console.log(JSON.stringify({ ok: pass, checks }, null, 2));
  return { ok: pass };
}

/**
 * Bulk archive school year: seed 3 projects in 'dev-yy' + 1 in 'other-yy';
 * archive 'dev-yy'; verify; unarchive one; verify; cleanup.
 *
 * NOTE: this test creates Drive folders. They are cleaned at the end but
 * Apps Script Drive ops are not transactional — if the test crashes mid-
 * run, the dev folder layout will need a manual cleanup pass.
 */
function devTestArchiveSchoolYear() {
  const checks = [];
  const check = (label, ok) => { checks.push({ label, ok }); };
  const actor = getActorEmail_();
  const bundleId = listBundles_()[0].bundleId;
  const ids = [];
  try {
    ['dev-yy:Alpha', 'dev-yy:Beta', 'dev-yy:Gamma', 'other-yy:Delta'].forEach((label) => {
      const [year, name] = label.split(':');
      const p = createProject_({
        name: 'archive-test ' + name,
        schoolYear: year,
        bundleId,
        memberClasses: ['DEV'],
        createdBy: actor,
      });
      ids.push(p.projectId);
    });

    const result = adminArchiveSchoolYear('dev-yy', 'ARCHIVE dev-yy');
    check('result ok',       result.ok === true);
    check('archived 3',      result.archived.length === 3);
    check('errors empty',    result.errors.length === 0);

    // Confirm registry states.
    const allAfter = listProjects_();
    const dyyArchived = allAfter.filter((p) => p.schoolYear === 'dev-yy' && p.status === PROJECT_STATUS.ARCHIVED);
    check('dev-yy all archived', dyyArchived.length === 3);
    const otherActive = allAfter.find((p) => p.schoolYear === 'other-yy' && p.name === 'archive-test Delta');
    check('other-yy untouched',   otherActive && otherActive.status === PROJECT_STATUS.ACTIVE);

    // Confirm Drive moves on first archived project.
    const firstArchived = allAfter.find((p) => p.projectId === ids[0]);
    const folder = DriveApp.getFolderById(firstArchived.rootFolderId);
    const parents = folder.getParents();
    let underArchived = false;
    while (parents.hasNext()) {
      if (parents.next().getName() === NAMES.ARCHIVED_FOLDER) underArchived = true;
    }
    check('first project under Archived/', underArchived);

    // Confirm 3 audit events written.
    const events = ids.slice(0, 3).map((id) => listAuditEventsForProject_(id));
    check('audit events for each', events.every((arr) => arr.length >= 1));

    // Unarchive one — separate path. Verify audit + folder restore.
    const unResult = consoleUnarchiveProject(ids[0]);
    check('unarchive ok', unResult.ok === true);
    const restoredFolder = DriveApp.getFolderById(firstArchived.rootFolderId);
    const restoredParents = restoredFolder.getParents();
    let underRoot = false;
    while (restoredParents.hasNext()) {
      if (restoredParents.next().getId() === CONFIG.ROOT_FOLDER_ID) underRoot = true;
    }
    check('first project restored to root', underRoot);

    const unEvents = listAuditEventsForProject_(ids[0]).filter((e) => e.action === AUDIT_ACTIONS.UNARCHIVE);
    check('unarchive audit event written', unEvents.length === 1);
  } finally {
    // Cleanup: archive the unarchived one back, then "delete" all 4 projects
    // by archiving them — actual deletion is out of scope. The dev folders
    // accumulate; clean by hand in the GAS UI / Drive if they pile up.
    ids.forEach((id) => {
      try { archiveProject_(id); } catch (e) { /* may already be archived */ }
    });
  }
  const pass = checks.every((c) => c.ok);
  console.log(JSON.stringify({ ok: pass, checks }, null, 2));
  return { ok: pass };
}

// ============================================================
// Sub-project D: groups
// ============================================================

/**
 * Shared seed helper: ensures N dev students exist in the DEV class with
 * the actor's TeacherEmail. Returns the array of emails in order.
 *
 * Cleanup is the caller's responsibility — see devGroupsTestCleanup_.
 */
function devGroupsSeedRoster_(count) {
  const me = Session.getEffectiveUser().getEmail();
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.ROSTER);
  const emails = [];
  for (let i = 1; i <= count; i++) {
    const email = 'devgroups.student' + i + '@orono.k12.mn.us';
    emails.push(email);
    if (findRowByKey_(tab, HEADERS.ROSTER, 'Email', email) < 0) {
      appendRow_(tab, HEADERS.ROSTER, {
        ID: '', First: 'DevG' + i, Last: 'Student',
        Email: email, Class: 'DEV', Teacher: 'Dev Owner', TeacherEmail: me,
      });
    }
  }
  return emails;
}

/**
 * Delete dev-groups roster rows and clean up any [grp] / Archived-students
 * artifacts left over in the Dev Project. Best-effort; tolerates failures.
 */
function devGroupsTestCleanup_(emails) {
  const project = devSeedDevProject();
  const projectFolder = DriveApp.getFolderById(project.rootFolderId);
  const classFolder = findChildFolder_(projectFolder, 'DEV');

  // Trash any group Sheets in DEV class (and in DEV/Archived-students).
  if (classFolder) {
    [classFolder, findChildFolder_(classFolder, NAMES.ARCHIVED_STUDENTS_FOLDER)].forEach((parent) => {
      if (!parent) return;
      const files = parent.getFiles();
      while (files.hasNext()) {
        const f = files.next();
        const n = f.getName();
        if (n.indexOf(NAMES.GROUP_SHEET_PREFIX) === 0) {
          try { f.setTrashed(true); } catch (e) {}
        }
      }
    });
    // Trash any solo Sheets named like our dev emails.
    [classFolder, findChildFolder_(classFolder, NAMES.ARCHIVED_STUDENTS_FOLDER)].forEach((parent) => {
      if (!parent) return;
      emails.forEach((e) => {
        const f = findChildFile_(parent, e);
        if (f) { try { f.setTrashed(true); } catch (err) {} }
      });
    });
  }

  // Remove roster rows.
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const tab = getTab_(ss, TABS.ROSTER);
  emails.forEach((email) => {
    const idx = findRowByKey_(tab, HEADERS.ROSTER, 'Email', email);
    if (idx > 0) { try { tab.deleteRow(idx); } catch (e) {} }
  });
}

/**
 * Plain-language assertion helper that mirrors devTestConsoleDashboardEndToEnd's
 * pattern. Returns the running pass/fail tallies for the caller to log.
 */
function devGroupsChecker_() {
  const state = { pass: 0, fail: 0 };
  const check = (label, cond) => {
    if (cond) { state.pass++; console.log('PASS ' + label); }
    else      { state.fail++; console.log('FAIL ' + label); }
  };
  return { check, state };
}

/**
 * Confirms findOrCreateStudentSheet_ routes group members to the group
 * Sheet after a merge — covering the spec's central invariant.
 */
function devTestGroupRoutingProvisioning() {
  const project = devSeedDevProject();
  const emails = devGroupsSeedRoster_(3);
  const { check, state } = devGroupsChecker_();
  try {
    resetGroupSheetCache_();
    const merge = consoleGroupCreate(project.projectId, 'RoutingProbe', emails);
    check('merge ok', merge && merge.ok === true);
    check('groupId present', !!merge.groupId);
    check('group Sheet ID returned', !!merge.groupSheetId);

    // Solo Sheets are trashed on merge — the group Sheet is the sole store.
    const projectFolder = DriveApp.getFolderById(project.rootFolderId);
    const classFolder = findChildFolder_(projectFolder, 'DEV');
    check('no solo Sheets remain at class root',
      emails.every((e) => findChildFile_(classFolder, e) === null));

    resetGroupSheetCache_();
    emails.forEach((e) => {
      const ss = findOrCreateStudentSheet_(e, project);
      check('routes ' + e + ' to group Sheet', ss && ss.getId() === merge.groupSheetId);
    });

    // Members tab has all three current entries.
    const grpSs = SpreadsheetApp.openById(merge.groupSheetId);
    const current = currentMembers_(grpSs);
    check('3 current members', current.length === 3);
  } finally {
    // Cleanup: disband, then trash any leftovers.
    try {
      resetGroupSheetCache_();
      const groups = listGroupsForProject_(project, 'DEV');
      groups.forEach((g) => {
        try { consoleGroupDisband(project.projectId, g.groupId); } catch (e) {}
      });
    } catch (e) {}
    devGroupsTestCleanup_(emails);
  }
  console.log(state.pass + '/' + (state.pass + state.fail) + ' passed');
  return state;
}

/**
 * Seeds 3 students with 2 sources and 4 highlights each pre-merge, merges,
 * and asserts row counts + createdByEmail preservation.
 */
function devTestGroupMergeMigrationFidelity() {
  const project = devSeedDevProject();
  const emails = devGroupsSeedRoster_(3);
  const { check, state } = devGroupsChecker_();
  try {
    resetGroupSheetCache_();
    const bundle = listBundles_().find((b) => b.bundleId === project.bundleId);

    // Seed: provision each student's solo Sheet and add 2 sources + 4 highlights.
    emails.forEach((email, idx) => {
      const ss = findOrCreateStudentSheet_(email, project);
      for (let s = 0; s < 2; s++) {
        const sourceId = uuid_();
        upsertSource_(ss, {
          sourceId, projectId: project.projectId,
          rawUrl: 'https://devg.example.com/' + email + '/' + s,
          scrapedTitle: 'devG ' + email + ' source ' + s,
          primarySecondary: 'primary',
          annotation: 'annot',
          citationFields: JSON.stringify({title:'t',url:'https://devg.example.com/' + email + '/' + s}),
          createdByEmail: email,
        });
        for (let h = 0; h < 2; h++) {
          upsertHighlight_(ss, {
            highlightId: uuid_(), sourceId, projectId: project.projectId,
            primaryCategory: bundle['label' + (((idx + h) % 5) + 1)],
            highlightedText: 'hl ' + email + ' s' + s + ' h' + h,
            createdByEmail: email,
          });
        }
      }
    });

    // Merge.
    resetGroupSheetCache_();
    const merge = consoleGroupCreate(project.projectId, 'MigrationProbe', emails);
    check('merge ok', merge && merge.ok === true);
    check('sourcesCopied = 6',    merge.sourcesCopied === 6);
    check('highlightsCopied = 12', merge.highlightsCopied === 12);

    const grpSs = SpreadsheetApp.openById(merge.groupSheetId);
    const sources    = readAllAsObjects_(getTab_(grpSs, TABS.SOURCES),    HEADERS.SOURCES);
    const highlights = readAllAsObjects_(getTab_(grpSs, TABS.HIGHLIGHTS), HEADERS.HIGHLIGHTS);
    check('group has 6 sources',    sources.length === 6);
    check('group has 12 highlights', highlights.length === 12);

    const allEmailsPreserved = highlights.every((h) => emails.indexOf(String(h.createdByEmail).toLowerCase()) >= 0);
    check('every highlight createdByEmail preserved', allEmailsPreserved);

    const projectFolder = DriveApp.getFolderById(project.rootFolderId);
    const classFolder = findChildFolder_(projectFolder, 'DEV');
    check('solo Sheets trashed post-merge', emails.every((e) => findChildFile_(classFolder, e) === null));
  } finally {
    try {
      resetGroupSheetCache_();
      const groups = listGroupsForProject_(project, 'DEV');
      groups.forEach((g) => { try { consoleGroupDisband(project.projectId, g.groupId); } catch (e) {} });
    } catch (e) {}
    devGroupsTestCleanup_(emails);
  }
  console.log(state.pass + '/' + (state.pass + state.fail) + ' passed');
  return state;
}

/**
 * Merge 3 (each with 1 source + 1 highlight), disband, assert each member's
 * solo Sheet is RECONSTRUCTED from the group with their own rows (their
 * group-period work follows them), the group Sheet is archived, and routing
 * falls back to the solo Sheet.
 */
function devTestGroupDisbandRoundTrip() {
  const project = devSeedDevProject();
  const emails = devGroupsSeedRoster_(3);
  const { check, state } = devGroupsChecker_();
  try {
    const bundle = listBundles_().find((b) => b.bundleId === project.bundleId);
    // Seed each solo with 1 source + 1 highlight so reconstruct has rows to pull.
    const srcByEmail = {};
    emails.forEach((email) => {
      const ss = findOrCreateStudentSheet_(email, project);
      const sourceId = 'disband-src-' + email;
      srcByEmail[email] = sourceId;
      upsertSource_(ss, {
        sourceId, projectId: project.projectId,
        rawUrl: 'https://devg.example.com/disband/' + email,
        scrapedTitle: 'disband ' + email, primarySecondary: 'primary', annotation: 'a',
        citationFields: JSON.stringify({ title: 't', url: 'https://devg.example.com/disband/' + email }),
        createdByEmail: email,
      });
      upsertHighlight_(ss, {
        highlightId: 'disband-hl-' + email, sourceId, projectId: project.projectId,
        primaryCategory: bundle.label1, highlightedText: 'hl ' + email, createdByEmail: email,
      });
    });

    resetGroupSheetCache_();
    const merge = consoleGroupCreate(project.projectId, 'DisbandProbe', emails);
    const disband = consoleGroupDisband(project.projectId, merge.groupId);
    check('disband ok', disband && disband.ok === true);
    check('restoredCount = 3', disband.restoredCount === 3);

    // Each solo Sheet exists again at class root, reconstructed with ONLY that
    // member's own source + highlight.
    const projectFolder = DriveApp.getFolderById(project.rootFolderId);
    const classFolder = findChildFolder_(projectFolder, 'DEV');
    emails.forEach((e) => {
      const f = findChildFile_(classFolder, e);
      check('solo Sheet reconstructed for ' + e, !!f);
      if (f) {
        const ss = SpreadsheetApp.openById(f.getId());
        const meta = readGroupMeta_(ss);
        check('Meta.groupId cleared for ' + e, !meta.groupId);
        const srcs = readAllAsObjects_(getTab_(ss, TABS.SOURCES), HEADERS.SOURCES);
        const hls  = readAllAsObjects_(getTab_(ss, TABS.HIGHLIGHTS), HEADERS.HIGHLIGHTS);
        check('reconstructed solo has only own source for ' + e,
          srcs.length === 1 && srcs[0].sourceId === srcByEmail[e]);
        check('reconstructed solo has only own highlight for ' + e,
          hls.length === 1 && String(hls[0].createdByEmail).toLowerCase() === e);
      }
    });

    // Routing: a write should now go back to the solo Sheet.
    resetGroupSheetCache_();
    const ss = findOrCreateStudentSheet_(emails[0], project);
    check('write routes back to solo', ss.getId() !== merge.groupSheetId);
  } finally {
    devGroupsTestCleanup_(emails);
  }
  console.log(state.pass + '/' + (state.pass + state.fail) + ' passed');
  return state;
}

/**
 * Merge A+B into G1 and C+D into G2; give C and D a source+highlight each in
 * G2. Move D → G1: D's work FOLLOWS to G1, and G2 drops to 1 (C) so it
 * auto-disbands, returning C to a reconstructed solo with their own work.
 */
function devTestGroupMoveSemantics() {
  const project = devSeedDevProject();
  const emails = devGroupsSeedRoster_(4);   // A=0, B=1, C=2, D=3
  const { check, state } = devGroupsChecker_();
  try {
    resetGroupSheetCache_();
    const g1 = consoleGroupCreate(project.projectId, 'MoveG1', [emails[0], emails[1]]);
    const g2 = consoleGroupCreate(project.projectId, 'MoveG2', [emails[2], emails[3]]);

    // Seed C and D a source+highlight each in G2.
    const g2Ss = SpreadsheetApp.openById(g2.groupSheetId);
    const bundle = listBundles_().find((b) => b.bundleId === project.bundleId);
    [emails[2], emails[3]].forEach((email) => {
      const sid = 'move-src-' + email;
      upsertSource_(g2Ss, {
        sourceId: sid, projectId: project.projectId,
        rawUrl: 'https://devg.example.com/move/' + email, scrapedTitle: 'move ' + email,
        primarySecondary: 'primary', annotation: 'a',
        citationFields: JSON.stringify({ title: 't', url: 'https://devg.example.com/move/' + email }),
        createdByEmail: email,
      });
      upsertHighlight_(g2Ss, {
        highlightId: 'move-hl-' + email, sourceId: sid, projectId: project.projectId,
        primaryCategory: bundle.label1, highlightedText: 'hl ' + email, createdByEmail: email,
      });
    });

    // Move D → G1.
    const move = consoleGroupMoveStudent(project.projectId, emails[3], g2.groupId, g1.groupId);
    check('move ok', move && move.ok === true);

    // G1 now has 3 current members incl D; D's highlight followed into G1.
    resetGroupSheetCache_();
    const g1Members = currentMembers_(SpreadsheetApp.openById(g1.groupSheetId));
    check('G1 has 3 current', g1Members.length === 3);
    check('D is a current member of G1', g1Members.some((m) => String(m.email).toLowerCase() === emails[3]));
    const g1Highlights = readAllAsObjects_(getTab_(SpreadsheetApp.openById(g1.groupSheetId), TABS.HIGHLIGHTS), HEADERS.HIGHLIGHTS);
    check("D's highlight followed into G1", g1Highlights.some((h) => String(h.createdByEmail).toLowerCase() === emails[3]));

    // G2 dropped to 1 (C) → auto-disbanded; C reconstructed to a solo with their own work.
    check('G2 auto-disbanded', getGroupById_(project, g2.groupId) === null);
    const projectFolder = DriveApp.getFolderById(project.rootFolderId);
    const classFolder = findChildFolder_(projectFolder, 'DEV');
    const cFile = findChildFile_(classFolder, emails[2]);
    check('C reconstructed to solo', !!cFile);
    if (cFile) {
      const cHls = readAllAsObjects_(getTab_(SpreadsheetApp.openById(cFile.getId()), TABS.HIGHLIGHTS), HEADERS.HIGHLIGHTS);
      check('C solo has their own highlight', cHls.some((h) => String(h.createdByEmail).toLowerCase() === emails[2]));
    }
    resetGroupSheetCache_();
    check('C no longer grouped', findGroupSheetForStudent_(emails[2], project) === null);
  } finally {
    try {
      resetGroupSheetCache_();
      const groups = listGroupsForProject_(project, 'DEV');
      groups.forEach((g) => { try { consoleGroupDisband(project.projectId, g.groupId); } catch (e) {} });
    } catch (e) {}
    devGroupsTestCleanup_(emails);
  }
  console.log(state.pass + '/' + (state.pass + state.fail) + ' passed');
  return state;
}

/**
 * Add an ungrouped, same-class student (with their own work) to an existing
 * group: their rows are copied in, their solo Sheet is trashed, and reads
 * route them to the group.
 */
function devTestGroupAddToGroup() {
  const project = devSeedDevProject();
  const emails = devGroupsSeedRoster_(3);   // A=0, B=1, C=2
  const { check, state } = devGroupsChecker_();
  try {
    const bundle = listBundles_().find((b) => b.bundleId === project.bundleId);
    // C gets a solo source + highlight before being added.
    const cSheet = findOrCreateStudentSheet_(emails[2], project);
    const cSourceId = 'add-src-' + emails[2];
    upsertSource_(cSheet, {
      sourceId: cSourceId, projectId: project.projectId,
      rawUrl: 'https://devg.example.com/add/' + emails[2], scrapedTitle: 'add C',
      primarySecondary: 'primary', annotation: 'a',
      citationFields: JSON.stringify({ title: 't', url: 'https://devg.example.com/add/' + emails[2] }),
      createdByEmail: emails[2],
    });
    upsertHighlight_(cSheet, {
      highlightId: 'add-hl-' + emails[2], sourceId: cSourceId, projectId: project.projectId,
      primaryCategory: bundle.label1, highlightedText: 'hl C', createdByEmail: emails[2],
    });

    resetGroupSheetCache_();
    const g = consoleGroupCreate(project.projectId, 'AddProbe', [emails[0], emails[1]]);
    const added = consoleAddToGroup(project.projectId, g.groupId, emails[2]);
    check('add ok', added && added.ok === true);
    check('C source copied in', added.copiedSources === 1);
    check('C highlight copied in', added.copiedHighlights === 1);

    resetGroupSheetCache_();
    const grpSs = SpreadsheetApp.openById(g.groupSheetId);
    check('group now has 3 members', currentMembers_(grpSs).length === 3);
    const grpHls = readAllAsObjects_(getTab_(grpSs, TABS.HIGHLIGHTS), HEADERS.HIGHLIGHTS);
    check("C's highlight is in the group", grpHls.some((h) => String(h.createdByEmail).toLowerCase() === emails[2]));
    check('C routes to the group', (function () {
      const ss = findOrCreateStudentSheet_(emails[2], project);
      return ss && ss.getId() === g.groupSheetId;
    })());

    // C's solo Sheet was trashed.
    const projectFolder = DriveApp.getFolderById(project.rootFolderId);
    const classFolder = findChildFolder_(projectFolder, 'DEV');
    check('C solo Sheet trashed', findChildFile_(classFolder, emails[2]) === null);
  } finally {
    try {
      resetGroupSheetCache_();
      const groups = listGroupsForProject_(project, 'DEV');
      groups.forEach((g) => { try { consoleGroupDisband(project.projectId, g.groupId); } catch (e) {} });
    } catch (e) {}
    devGroupsTestCleanup_(emails);
  }
  console.log(state.pass + '/' + (state.pass + state.fail) + ' passed');
  return state;
}

/**
 * Authorization: non-staff blocked; teacher-out-of-scope blocked; mixed-
 * class merge blocked. Mirrors devTestAdminAuthGate's stash-restore pattern.
 */
function devTestGroupAuthorizationGate() {
  const project = devSeedDevProject();
  const emails = devGroupsSeedRoster_(3);
  // Add two DEV2 roster rows so mixed-class is reproducible.
  const me = Session.getEffectiveUser().getEmail();
  const rosterSs = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const rosterTab = getTab_(rosterSs, TABS.ROSTER);
  const dev2 = ['devgroups.dev2a@orono.k12.mn.us', 'devgroups.dev2b@orono.k12.mn.us'];
  dev2.forEach((e, i) => {
    if (findRowByKey_(rosterTab, HEADERS.ROSTER, 'Email', e) < 0) {
      appendRow_(rosterTab, HEADERS.ROSTER, {
        ID:'', First:'DG2'+i, Last:'Student', Email:e, Class:'DEV2',
        Teacher:'Other', TeacherEmail:'somebody.else@orono.k12.mn.us',
      });
    }
  });

  const { check, state } = devGroupsChecker_();
  try {
    // Same-class invariant: mixed DEV + DEV2 must throw.
    let mixedThrew = false;
    try { consoleGroupCreate(project.projectId, 'MixedClass', [emails[0], dev2[0]]); }
    catch (e) { mixedThrew = true; check('mixed-class merge throws', /same class/i.test(e.message)); }
    if (!mixedThrew) check('mixed-class merge throws', false);

    // Already-in-a-group: merge {A,B}, then try to add A again → throws.
    const g = consoleGroupCreate(project.projectId, 'AlreadyInGroup', [emails[0], emails[1]]);
    let alreadyThrew = false;
    try { consoleGroupCreate(project.projectId, 'AnotherWithA', [emails[0], emails[2]]); }
    catch (e) { alreadyThrew = true; check('already-in-a-group merge throws', /already in a group/i.test(e.message)); }
    if (!alreadyThrew) check('already-in-a-group merge throws', false);

    // Teacher-out-of-scope: demote actor to teacher of a phantom class, attempt DEV merge → throws.
    const staffTab = getTab_(rosterSs, TABS.STAFF);
    const sIdx = findRowByKey_(staffTab, HEADERS.STAFF, 'Email', me);
    const origRole = staffTab.getRange(sIdx, HEADERS.STAFF.indexOf('Role') + 1).getValue();
    staffTab.getRange(sIdx, HEADERS.STAFF.indexOf('Role') + 1).setValue(ROLES.TEACHER);
    try {
      // Also temporarily flip our roster TeacherEmail to nobody, so listClassesTaughtBy_(me) returns [].
      const rIdx = findRowByKey_(rosterTab, HEADERS.ROSTER, 'Email', emails[0]);
      const teCol = HEADERS.ROSTER.indexOf('TeacherEmail') + 1;
      // We can't easily flip every row, but we can stash and flip rows for emails we care about.
      const stashed = emails.map((e) => {
        const idx = findRowByKey_(rosterTab, HEADERS.ROSTER, 'Email', e);
        const orig = rosterTab.getRange(idx, teCol).getValue();
        rosterTab.getRange(idx, teCol).setValue('phantom.teacher@orono.k12.mn.us');
        return { idx, orig };
      });
      let scopeThrew = false;
      try { consoleGroupCreate(project.projectId, 'OutOfScope', [emails[2], dev2[1]]); }
      catch (e) { scopeThrew = true; check('teacher out-of-scope throws', /scope|same class/i.test(e.message)); }
      if (!scopeThrew) check('teacher out-of-scope throws', false);
      // Restore stashed TeacherEmail values.
      stashed.forEach((s) => rosterTab.getRange(s.idx, teCol).setValue(s.orig));
    } finally {
      // Restore role.
      staffTab.getRange(sIdx, HEADERS.STAFF.indexOf('Role') + 1).setValue(origRole);
    }

    // Disband the AlreadyInGroup group before cleanup.
    try { consoleGroupDisband(project.projectId, g.groupId); } catch (e) {}
  } finally {
    // Remove DEV2 roster rows + clean up.
    dev2.forEach((e) => {
      const idx = findRowByKey_(rosterTab, HEADERS.ROSTER, 'Email', e);
      if (idx > 0) { try { rosterTab.deleteRow(idx); } catch (err) {} }
    });
    try {
      resetGroupSheetCache_();
      const groups = listGroupsForProject_(project, 'DEV');
      groups.forEach((gr) => { try { consoleGroupDisband(project.projectId, gr.groupId); } catch (e) {} });
    } catch (e) {}
    devGroupsTestCleanup_(emails);
  }
  console.log(state.pass + '/' + (state.pass + state.fail) + ' passed');
  return state;
}

/**
 * Run every sub-project-D group test in sequence and print ONE summary, so
 * you don't have to Run each from the editor dropdown. Each test seeds its own
 * fixture and cleans up in a finally block, so back-to-back runs are safe.
 * Returns { ok, pass, fail, threw }.
 */
function devTestGroupsAll() {
  const tests = [
    ['devTestGroupRoutingProvisioning',    devTestGroupRoutingProvisioning],
    ['devTestGroupMergeMigrationFidelity', devTestGroupMergeMigrationFidelity],
    ['devTestGroupDisbandRoundTrip',       devTestGroupDisbandRoundTrip],
    ['devTestGroupMoveSemantics',          devTestGroupMoveSemantics],
    ['devTestGroupAddToGroup',             devTestGroupAddToGroup],
    ['devTestGroupAuthorizationGate',      devTestGroupAuthorizationGate],
  ];
  let pass = 0, fail = 0, threw = 0;
  const lines = [];
  tests.forEach((entry) => {
    const name = entry[0];
    try {
      const s = entry[1]() || {};
      const p = s.pass || 0, f = s.fail || 0;
      pass += p; fail += f;
      lines.push((f === 0 ? 'PASS  ' : 'FAIL  ') + name + '  (' + p + '/' + (p + f) + ')');
    } catch (e) {
      threw++;
      lines.push('THREW ' + name + '  — ' + (e && e.message || e));
    }
  });
  const ok = (fail === 0 && threw === 0);
  console.log(
    '===== devTestGroupsAll =====\n' + lines.join('\n') +
    '\n----------------------------\nTOTAL ' + pass + ' checks passed, ' + fail +
    ' failed, ' + threw + ' threw  →  ' + (ok ? 'ALL GREEN' : 'NOT GREEN')
  );
  return { ok: ok, pass: pass, fail: fail, threw: threw };
}

// ============================================================
// Richer citation scrape: scrapedExtra storage + additive header heal
// ============================================================

/**
 * Round-trips the scrapedExtra JSON column: upsertSource_ stores it, the read
 * side surfaces it as a parsed object, and sidebarGetProjectData exposes
 * scrapedExtraParsed for the citation-form pre-fill. (The DOM-side scraper in
 * extension/content/scrape.js can't run under GAS — that's manual page QA.)
 */
function devTestScrapedExtraRoundTrip() {
  const project = devSeedDevProject();
  const me = Session.getEffectiveUser().getEmail();
  const ss = findOrCreateStudentSheet_(me, project);
  const sourceId = 'devtest-scrapedextra';
  const extra = {
    publication: 'Journal of Dev Testing', publisher: 'Dev Press',
    volume: '12', issue: '3', pages: '45-60', sourceType: 'article',
  };
  upsertSource_(ss, {
    sourceId, projectId: project.projectId,
    rawUrl: 'https://devtest.example.com/scrapedextra',
    scrapedTitle: 'Scraped Extra Source', scrapedAuthor: 'Doe, Jane',
    scrapedExtra: extra, createdByEmail: me,
  });

  let pass = 0, fail = 0;
  const check = (label, cond) => {
    if (cond) { pass++; console.log('PASS ' + label); }
    else      { fail++; console.log('FAIL ' + label); }
  };

  const rows = readAllAsObjects_(getTab_(ss, TABS.SOURCES), HEADERS.SOURCES);
  const row = rows.find((r) => r.sourceId === sourceId);
  check('source row found', !!row);
  if (row) {
    check('scrapedExtra stored as string', typeof row.scrapedExtra === 'string' && row.scrapedExtra.length > 0);
    const parsed = parseJsonColumn_(row.scrapedExtra);
    check('publication round-trips', parsed.publication === extra.publication);
    check('volume round-trips',      parsed.volume === extra.volume);
    check('pages round-trips',       parsed.pages === extra.pages);
    check('inferred sourceType round-trips', parsed.sourceType === 'article');
  }

  const data = sidebarGetProjectData(project.projectId);
  check('sidebarGetProjectData ok', data && data.ok === true);
  const src = data.sources.find((s) => s.sourceId === sourceId);
  check('source surfaced to sidebar', !!src);
  if (src) {
    check('scrapedExtraParsed present', src.scrapedExtraParsed && src.scrapedExtraParsed.publication === extra.publication);
    check('citationFieldsParsed still present', !!src.citationFieldsParsed);
  }

  console.log(pass + '/' + (pass + fail) + ' passed');
  return { pass, fail };
}

/**
 * previewCitation GET delegates to the MLA formatter and returns
 * { ok, text, italics }. Single source of truth — the extension Source tab
 * renders this rather than forking the formatter.
 */
function devTestPreviewCitation() {
  const fields = {
    sourceType: 'website',
    title: 'The Role of Technology in Blended Learning',
    siteName: 'Journal of Language and Education',
    author: 'Hekmat, Ali Mohammad',
    publishedDate: '2023',
    url: 'https://example.org/blended-learning',
  };
  const resp = handleGet_({ parameter: {
    action: 'previewCitation',
    fields: JSON.stringify(fields),
    style: 'mla',
  } });
  let pass = 0, fail = 0;
  const check = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };
  check('resp.ok', resp && resp.ok === true);
  check('text non-empty', resp && typeof resp.text === 'string' && resp.text.length > 0);
  check('italics is array', resp && Array.isArray(resp.italics));
  console.log(fail === 0 ? 'devTestPreviewCitation: ALL GREEN — ' + (resp && resp.text) : 'devTestPreviewCitation: NOT GREEN (' + fail + ' fail)');
}

/**
 * Locks the robust date parser behind formatMlaDate_ / yearOnly_. Covers the
 * formats the old `new Date()` path mangled — ordinals ("April 16th, 2020"),
 * separator-less compact dates ("20200416") — plus ISO/US/slash/month-name
 * variants and graceful echo of unparseable strings. No timezone round-trip,
 * so ISO dates no longer drift a day under the script timezone.
 */
function devTestMlaDateFormatting() {
  const full = [
    ['2020-04-16',        '16 Apr. 2020'],
    ['2020-4-6',          '6 Apr. 2020'],
    ['2020/04/16',        '16 Apr. 2020'],
    ['2020.04.16',        '16 Apr. 2020'],
    ['20200416',          '16 Apr. 2020'],
    ['20260305',          '5 Mar. 2026'],
    ['April 16, 2020',    '16 Apr. 2020'],
    ['April 16th, 2020',  '16 Apr. 2020'],
    ['Apr. 16 2020',      '16 Apr. 2020'],
    ['16 April 2020',     '16 Apr. 2020'],
    ['1st March 2021',    '1 Mar. 2021'],
    ['4/16/2020',         '16 Apr. 2020'],
    ['May 3, 2026',       '3 May 2026'],
    ['April 2020',        'Apr. 2020'],
    ['202004',            'Apr. 2020'],
    ['Sept 2019',         'Sept. 2019'],
    ['2020',              '2020'],
    ['',                  ''],
    ['n.d.',              'n.d.'],          // unparseable → echoed verbatim
    ['Spring 2020',       'Spring 2020'],   // season qualifier preserved
  ];
  const years = [
    ['2020-04-16',        '2020'],
    ['20200416',          '2020'],
    ['April 16th, 2020',  '2020'],
    ['2020',              '2020'],
    ['c. 1850',           'c. 1850'],       // unparseable → echoed verbatim
    ['',                  ''],
  ];
  let pass = 0, fail = 0;
  const run = (fn, name, cases) => cases.forEach(([raw, expected]) => {
    const got = fn(raw);
    const ok = got === expected;
    if (ok) pass++; else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}(${JSON.stringify(raw)}) = ${JSON.stringify(got)} (expected ${JSON.stringify(expected)})`);
  });
  run(formatMlaDate_, 'formatMlaDate_', full);
  run(yearOnly_, 'yearOnly_', years);
  console.log((fail === 0 ? 'devTestMlaDateFormatting: ALL GREEN' : 'devTestMlaDateFormatting: NOT GREEN (' + fail + ' fail)') + ` — ${pass} passed`);
  return { pass, fail };
}

/**
 * doPost deletes accept { kind:'source', id } and route to the orphan-safe
 * deleteSourceIfOrphaned_ — removes a source with no referencing highlights,
 * refuses one that still has evidence. Backs the extension's "Delete source"
 * toast action.
 */
function devTestSourceDeleteViaPost() {
  const project = devSeedDevProject();
  const me = Session.getEffectiveUser().getEmail();
  const ss = findOrCreateStudentSheet_(me, project);

  const orphanId = uuid_();
  const referencedId = uuid_();
  const hlId = uuid_();
  upsertSource_(ss, { sourceId: orphanId, projectId: project.projectId, rawUrl: 'https://orphan.example.com/x', scrapedTitle: 'Orphan', createdByEmail: me });
  upsertSource_(ss, { sourceId: referencedId, projectId: project.projectId, rawUrl: 'https://ref.example.com/x', scrapedTitle: 'Referenced', createdByEmail: me });
  upsertHighlight_(ss, { highlightId: hlId, sourceId: referencedId, projectId: project.projectId, primaryCategory: 'Background', highlightedText: 'keep me', createdByEmail: me });

  const post = (deletes) => handlePost_({ postData: { contents: JSON.stringify({ projectId: project.projectId, deletes }) } });
  const r1 = post([{ kind: 'source', id: orphanId }]);
  const r2 = post([{ kind: 'source', id: referencedId }]);

  const sourcesAfter = readSourcesForActor_(me, project.projectId);
  let pass = 0, fail = 0;
  const check = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };
  check('orphan delete ok', r1 && r1.ok === true);
  check('orphan deleted.sources === 1', r1 && r1.deleted && r1.deleted.sources === 1);
  check('orphan row gone', !sourcesAfter.find((s) => s.sourceId === orphanId));
  check('referenced deleted.sources === 0', r2 && r2.deleted && r2.deleted.sources === 0);
  check('referenced row still present', !!sourcesAfter.find((s) => s.sourceId === referencedId));

  // Cleanup.
  deleteHighlightById_(ss, hlId);
  deleteSourceIfOrphaned_(ss, referencedId);
  console.log(fail === 0 ? 'devTestSourceDeleteViaPost: ALL GREEN' : 'devTestSourceDeleteViaPost: NOT GREEN (' + fail + ' fail)');
}

/**
 * Locks the invariant the extension Source tab depends on: a citation write
 * (citationFields + sourceType + primarySecondary + annotation) survives a
 * later scrape-only re-assert (the shape getOrCreateSourceId enqueues, which
 * omits those keys). If this ever goes red, the extension's citation edits are
 * being clobbered by re-highlighting.
 */
function devTestCitationSurvivesReassert() {
  const project = devSeedDevProject();
  const me = Session.getEffectiveUser().getEmail();
  const ss = findOrCreateStudentSheet_(me, project);

  const sid = uuid_();
  // 1) Citation write (as the Source tab will send).
  upsertSource_(ss, {
    sourceId: sid, projectId: project.projectId, rawUrl: 'https://reassert.example.com/x',
    scrapedTitle: 'Scraped Title', createdByEmail: me,
    sourceType: 'article', primarySecondary: 'primary', annotation: 'My annotation.',
    citationFields: { sourceType: 'article', title: 'Edited Title', author: 'Doe, Jane' },
  });
  // 2) Scrape-only re-assert (as getOrCreateSourceId enqueues — no citation keys).
  upsertSource_(ss, {
    sourceId: sid, projectId: project.projectId, rawUrl: 'https://reassert.example.com/x',
    scrapedTitle: 'Scraped Title v2', scrapedAuthor: 'Scraper', createdByEmail: me,
    scrapedExtra: { publication: 'Some Journal' },
  });

  const src = readSourcesForActor_(me, project.projectId).find((s) => s.sourceId === sid);
  const cf = src ? JSON.parse(src.citationFields || '{}') : {};
  let pass = 0, fail = 0;
  const check = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };
  check('citationFields preserved', cf.title === 'Edited Title' && cf.author === 'Doe, Jane');
  check('sourceType preserved', src && src.sourceType === 'article');
  check('primarySecondary preserved', src && src.primarySecondary === 'primary');
  check('annotation preserved', src && src.annotation === 'My annotation.');
  check('scraped fields refreshed', src && src.scrapedTitle === 'Scraped Title v2');

  deleteSourceIfOrphaned_(ss, sid);
  console.log(fail === 0 ? 'devTestCitationSurvivesReassert: ALL GREEN' : 'devTestCitationSurvivesReassert: NOT GREEN (' + fail + ' fail)');
}

/**
 * Verifies ensureHeaders_ heals a pure trailing append in place (the migration
 * path for the new scrapedExtra column on already-provisioned Sheets) while
 * still throwing on a real reorder/rename. Uses a throwaway spreadsheet that
 * is trashed in a finally block.
 */
function devTestEnsureHeadersAppend() {
  let pass = 0, fail = 0;
  const check = (label, cond) => {
    if (cond) { pass++; console.log('PASS ' + label); }
    else      { fail++; console.log('FAIL ' + label); }
  };

  const scratch = SpreadsheetApp.create('OPS devtest ensureHeaders ' + uuid_());
  try {
    const tab = scratch.getSheets()[0];
    // Old, shorter schema with one data row.
    tab.getRange(1, 1, 1, 3).setValues([['a', 'b', 'c']]);
    tab.getRange(2, 1, 1, 3).setValues([['1', '2', '3']]);

    // Additive heal: append a trailing 'd' column.
    ensureHeaders_(tab, ['a', 'b', 'c', 'd']);
    const hdr = tab.getRange(1, 1, 1, 4).getValues()[0];
    check('trailing header appended', hdr[3] === 'd');
    check('existing headers untouched', hdr[0] === 'a' && hdr[1] === 'b' && hdr[2] === 'c');
    const dataRow = tab.getRange(2, 1, 1, 4).getValues()[0];
    check('existing data preserved + new cell blank',
      dataRow[0] === '1' && dataRow[2] === '3' && dataRow[3] === '');

    // Idempotent re-run.
    ensureHeaders_(tab, ['a', 'b', 'c', 'd']);
    check('idempotent re-run', tab.getRange(1, 4, 1, 1).getValue() === 'd');

    // A real reorder/rename within existing columns must still throw.
    let threw = false;
    try { ensureHeaders_(tab, ['a', 'X', 'c', 'd']); } catch (e) { threw = true; }
    check('reorder/rename still throws', threw);
  } finally {
    DriveApp.getFileById(scratch.getId()).setTrashed(true);
  }

  console.log(pass + '/' + (pass + fail) + ' passed');
  return { pass, fail };
}

/**
 * dedupeSourcesByUrl_ collapses same-normalizedUrl source rows: keeps the
 * OLDEST as canonical, folds duplicates' citation work in (canonical wins,
 * blanks filled from a duplicate), repoints duplicates' highlights onto the
 * canonical, and passes blank-url sources through. Pure — no Sheet I/O.
 * Backs the "duplicate sources in the dropdown" fix.
 */
function devTestDedupeSourcesByUrl() {
  const sources = [
    { sourceId: 'A', normalizedUrl: 'ex.com/p', createdAt: '2026-01-02', createdByEmail: 'stu@x',
      scrapedTitle: 'T', citationFields: JSON.stringify({ title: 'Edited' }),
      primarySecondary: 'unset', annotation: '' },
    { sourceId: 'B', normalizedUrl: 'ex.com/p', createdAt: '2026-01-01', createdByEmail: 'stu@x',
      scrapedTitle: 'T', citationFields: JSON.stringify({ author: 'Doe, Jane' }),
      primarySecondary: 'primary', annotation: 'My note.' },
    { sourceId: 'C', normalizedUrl: 'ex.com/other', createdAt: '2026-01-03', createdByEmail: 'stu@x',
      scrapedTitle: 'Other', citationFields: '', primarySecondary: 'secondary', annotation: '' },
    { sourceId: 'D', normalizedUrl: '', createdAt: '2026-01-04', createdByEmail: 'stu@x',
      scrapedTitle: 'NoUrl', citationFields: '', primarySecondary: 'unset', annotation: '' },
    // Same URL as E but a DIFFERENT author → must NOT merge (group attribution).
    { sourceId: 'E', normalizedUrl: 'ex.com/shared', createdAt: '2026-01-05', createdByEmail: 'm1@x',
      scrapedTitle: 'Sh', citationFields: '', primarySecondary: 'unset', annotation: '' },
    { sourceId: 'F', normalizedUrl: 'ex.com/shared', createdAt: '2026-01-06', createdByEmail: 'm2@x',
      scrapedTitle: 'Sh', citationFields: '', primarySecondary: 'unset', annotation: '' },
  ];
  const highlights = [
    { highlightId: 'h1', sourceId: 'A' },
    { highlightId: 'h2', sourceId: 'B' },
    { highlightId: 'h3', sourceId: 'C' },
    { highlightId: 'h4', sourceId: 'E' },
    { highlightId: 'h5', sourceId: 'F' },
  ];
  const out = dedupeSourcesByUrl_(sources, highlights);

  let pass = 0, fail = 0;
  const check = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

  // A+B (same author) collapse to B; C, D pass through; E & F are different
  // authors so both survive → 5 total.
  check('5 sources after dedup', out.sources.length === 5);
  const canon = out.sources.find((s) => s.sourceId === 'B');
  check('canonical is the oldest (B)', !!canon);
  check('A removed (merged into B)', !out.sources.find((s) => s.sourceId === 'A'));
  check('canonical keeps its primarySecondary', canon && canon.primarySecondary === 'primary');
  check('canonical keeps its annotation', canon && canon.annotation === 'My note.');
  const cf = canon ? (parseJsonColumn_(canon.citationFields) || {}) : {};
  check('canonical keeps its own field (author)', cf.author === 'Doe, Jane');
  check('canonical fills missing field from dup (title)', cf.title === 'Edited');
  check('h1 repointed A->B', out.highlights.find((h) => h.highlightId === 'h1').sourceId === 'B');
  check('h2 still on B', out.highlights.find((h) => h.highlightId === 'h2').sourceId === 'B');
  check('h3 still on C', out.highlights.find((h) => h.highlightId === 'h3').sourceId === 'C');
  check('blank-url source passes through', !!out.sources.find((s) => s.sourceId === 'D'));
  check('different-author same-URL NOT merged (E kept)', !!out.sources.find((s) => s.sourceId === 'E'));
  check('different-author same-URL NOT merged (F kept)', !!out.sources.find((s) => s.sourceId === 'F'));

  console.log(fail === 0 ? 'devTestDedupeSourcesByUrl: ALL GREEN' : 'devTestDedupeSourcesByUrl: NOT GREEN (' + fail + ' fail)');
  return { pass, fail };
}

/**
 * Integration: dedupeSourcesPersist_ physically removes duplicate source rows
 * from the student's Sheet (and repoints highlights), is idempotent, and leaves
 * unrelated rows alone. Seeds the DEV-class fixture and cleans up after itself.
 */
function devTestDedupeSourcesPersist() {
  const project = devSeedDevProject();
  const me = Session.getEffectiveUser().getEmail();
  const ss = findOrCreateStudentSheet_(me, project);

  const url = 'https://dedup.example.com/p';
  const norm = normalizeUrl_(url);
  const oldId = uuid_(), newId = uuid_(), ctrlId = uuid_();
  const h1 = uuid_(), h2 = uuid_(), hc = uuid_();
  // Two rows for the same page (same author): oldest = canonical.
  upsertSource_(ss, { sourceId: oldId, projectId: project.projectId, rawUrl: url, normalizedUrl: norm,
    createdAt: '2026-01-01T00:00:00.000Z', scrapedTitle: 'Dedup', primarySecondary: 'primary',
    citationFields: { author: 'Doe, Jane' }, createdByEmail: me });
  upsertSource_(ss, { sourceId: newId, projectId: project.projectId, rawUrl: url, normalizedUrl: norm,
    createdAt: '2026-01-02T00:00:00.000Z', scrapedTitle: 'Dedup', annotation: 'Newer note.', createdByEmail: me });
  upsertSource_(ss, { sourceId: ctrlId, projectId: project.projectId, rawUrl: 'https://other.example.com/x',
    scrapedTitle: 'Ctrl', createdByEmail: me });
  upsertHighlight_(ss, { highlightId: h1, sourceId: oldId, projectId: project.projectId, primaryCategory: 'Background', highlightedText: 'a', createdByEmail: me });
  upsertHighlight_(ss, { highlightId: h2, sourceId: newId, projectId: project.projectId, primaryCategory: 'Background', highlightedText: 'b', createdByEmail: me });
  upsertHighlight_(ss, { highlightId: hc, sourceId: ctrlId, projectId: project.projectId, primaryCategory: 'Background', highlightedText: 'c', createdByEmail: me });

  const removed = dedupeSourcesPersist_(ss);
  const sources = readSourcesForActor_(me, project.projectId);
  const highlights = readHighlightsForActor_(me, project.projectId);

  let pass = 0, fail = 0;
  const check = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };
  check('removed === 1', removed === 1);
  check('duplicate (newId) row gone', !sources.find((s) => s.sourceId === newId));
  check('canonical (oldId) kept', !!sources.find((s) => s.sourceId === oldId));
  check('control source kept', !!sources.find((s) => s.sourceId === ctrlId));
  const canon = sources.find((s) => s.sourceId === oldId) || {};
  check('canonical kept its own author', (parseJsonColumn_(canon.citationFields) || {}).author === 'Doe, Jane');
  check('canonical filled annotation from dup', canon.annotation === 'Newer note.');
  check('h2 repointed newId->oldId', (highlights.find((h) => h.highlightId === h2) || {}).sourceId === oldId);
  check('h1 still on oldId', (highlights.find((h) => h.highlightId === h1) || {}).sourceId === oldId);
  check('control highlight intact', (highlights.find((h) => h.highlightId === hc) || {}).sourceId === ctrlId);
  check('second run is a no-op (idempotent)', dedupeSourcesPersist_(ss) === 0);

  // Cleanup.
  deleteAllRowsWhere_(getTab_(ss, TABS.HIGHLIGHTS), HEADERS.HIGHLIGHTS, 'sourceId', oldId);
  deleteAllRowsWhere_(getTab_(ss, TABS.HIGHLIGHTS), HEADERS.HIGHLIGHTS, 'sourceId', ctrlId);
  deleteAllRowsWhere_(getTab_(ss, TABS.SOURCES), HEADERS.SOURCES, 'sourceId', oldId);
  deleteAllRowsWhere_(getTab_(ss, TABS.SOURCES), HEADERS.SOURCES, 'sourceId', ctrlId);

  console.log(fail === 0 ? 'devTestDedupeSourcesPersist: ALL GREEN' : 'devTestDedupeSourcesPersist: NOT GREEN (' + fail + ' fail)');
  return { pass, fail };
}

/**
 * partitionBibliographySources_ is the single source of truth for which sources
 * land in the bibliography. Annotated needs classified + non-empty annotation;
 * Works Cited needs classified only (annotation irrelevant); unclassified is
 * always omitted. The Docs sidebar mirrors this rule client-side to warn before
 * insert — if this goes red, the warning and the actual insert have drifted.
 */
function devTestBibliographyPartition() {
  const sources = [
    { sourceId: 'a', primarySecondary: 'primary',   annotation: 'has note' },
    { sourceId: 'b', primarySecondary: 'primary',   annotation: '   ' },     // whitespace = no annotation
    { sourceId: 'c', primarySecondary: 'secondary', annotation: 'note' },
    { sourceId: 'd', primarySecondary: 'secondary', annotation: '' },
    { sourceId: 'e', primarySecondary: 'unset',     annotation: 'note' },    // classified-unset but annotated
    { sourceId: 'f', primarySecondary: '',          annotation: '' },        // no classification at all
  ];
  let pass = 0, fail = 0;
  const check = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };
  const ids = (arr) => arr.map((s) => s.sourceId).sort().join(',');
  const omittedFor = (arr, reason) => arr.filter((o) => o.reason === reason).map((o) => o.source.sourceId).sort().join(',');

  const ann = partitionBibliographySources_(sources, true);
  check('annotated primary = [a]',        ids(ann.primary) === 'a');
  check('annotated secondary = [c]',      ids(ann.secondary) === 'c');
  check('annotated no-annotation = [b,d]', omittedFor(ann.omitted, 'no-annotation') === 'b,d');
  check('annotated unclassified = [e,f]',  omittedFor(ann.omitted, 'unclassified') === 'e,f');

  const wc = partitionBibliographySources_(sources, false);
  check('works-cited primary = [a,b]',    ids(wc.primary) === 'a,b');
  check('works-cited secondary = [c,d]',  ids(wc.secondary) === 'c,d');
  check('works-cited no no-annotation omissions', omittedFor(wc.omitted, 'no-annotation') === '');
  check('works-cited unclassified = [e,f]', omittedFor(wc.omitted, 'unclassified') === 'e,f');

  // Empty / null input is safe.
  const empty = partitionBibliographySources_(null, true);
  check('null input → empty buckets', empty.primary.length === 0 && empty.secondary.length === 0 && empty.omitted.length === 0);

  console.log(fail === 0 ? 'devTestBibliographyPartition: ALL GREEN' : 'devTestBibliographyPartition: NOT GREEN (' + fail + ' fail)');
  return { pass, fail };
}

// ============================================================
// Dashboard performance: manifest + parallel batch reader
// ============================================================

/**
 * Round-trips the per-(project, student) → spreadsheetId manifest:
 * record (lowercased key), upsert-replace (no dup), load map, forget.
 */
function devTestSheetManifestRoundTrip() {
  const project = devSeedDevProject();
  let pass = 0, fail = 0;
  const check = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };
  const email = 'devManifest.Student@orono.k12.mn.us';   // mixed-case to prove normalization
  const lower = email.toLowerCase();
  const fakeId = 'DEV_MANIFEST_FAKE_SSID';
  try {
    recordSoloSheetEntry_(project.projectId, email, fakeId, '111', '222', true);
    const e1 = loadProjectManifest_(project.projectId)[lower];
    check('records id under lowercased key', e1 && e1.id === fakeId);
    check('records tab gids', e1 && e1.sgid === '111' && e1.hgid === '222');
    check('entry reads as complete', manifestEntryComplete_(e1));

    recordSoloSheetEntry_(project.projectId, email, fakeId + '_v2', '333', '444', true);
    const e2 = loadProjectManifest_(project.projectId)[lower];
    check('upsert replaces entry (no duplicate)', e2 && e2.id === fakeId + '_v2' && e2.sgid === '333');

    forgetSoloSheetId_(project.projectId, email);
    check('forget removes the entry', !loadProjectManifest_(project.projectId)[lower]);
  } finally {
    forgetSoloSheetId_(project.projectId, email);
  }
  console.log(fail === 0 ? 'devTestSheetManifestRoundTrip: ALL GREEN' : 'devTestSheetManifestRoundTrip: NOT GREEN (' + fail + ')');
  return { pass, fail };
}

/**
 * KEYSTONE: the parallel batch-read dashboard path must produce aggregates
 * byte-for-byte identical to the original serial path. Builds a DEV fixture
 * with varied per-student data, merges 2 of 3 into a group (so the comparison
 * exercises BOTH the group-sheet createdByEmail filter and the solo manifest
 * path), then deep-compares computeDashboardSerial_ vs computeDashboardParallel_.
 *
 * NOTE: the parallel path reads via the Sheets REST API through UrlFetchApp,
 * which needs the `script.external_request` scope. The FIRST run of this test
 * in the editor triggers the one-time re-consent — approve it and re-run.
 */
function devTestDashboardParityParallelVsSerial() {
  const project = devSeedDevProject();
  const emails = devGroupsSeedRoster_(3);   // DEV class: 3 students
  const { check, state } = devGroupsChecker_();
  try {
    const bundle = listBundles_().find((b) => b.bundleId === project.bundleId);
    resetGroupSheetCache_();

    // Seed varied data: differing source counts, classifications, annotations,
    // and category mixes so the aggregates are non-trivial.
    emails.forEach((email, idx) => {
      const ss = findOrCreateStudentSheet_(email, project);
      const nSrc = idx + 1;   // 1, 2, 3 sources respectively
      for (let s = 0; s < nSrc; s++) {
        const sourceId = 'parity-' + idx + '-' + s;
        upsertSource_(ss, {
          sourceId, projectId: project.projectId,
          rawUrl: 'https://parity.example.com/' + idx + '/' + s,
          scrapedTitle: 'parity ' + email + ' ' + s,
          primarySecondary: (s % 2 === 0) ? 'primary' : 'unset',
          annotation: (s === 0) ? 'has annotation' : '',
          citationFields: JSON.stringify({ title: 't' + s, url: (s === 0) ? ('https://parity.example.com/' + idx + '/' + s) : '' }),
          createdByEmail: email,
        });
        for (let h = 0; h <= idx; h++) {
          upsertHighlight_(ss, {
            highlightId: 'parity-hl-' + idx + '-' + s + '-' + h,
            sourceId, projectId: project.projectId,
            primaryCategory: bundle['label' + (((idx + s + h) % 5) + 1)],
            secondaryCategory: '',
            highlightedText: 'text ' + idx + ' ' + s + ' ' + h,
            createdByEmail: email,
          });
        }
      }
    });

    // Merge two of three; leave one solo.
    resetGroupSheetCache_();
    const merge = consoleGroupCreate(project.projectId, 'ParityProbe', [emails[0], emails[1]]);
    check('merge ok', merge && merge.ok === true);

    SpreadsheetApp.flush();   // ensure the Sheets REST read sees all the writes

    const scoped = ['DEV'];
    resetGroupSheetCache_();
    const serial = computeDashboardSerial_(project, scoped, bundle);
    resetGroupSheetCache_();
    const parallel = computeDashboardParallel_(project, scoped, bundle);

    const norm = (r) => ({
      students: (r.students || []).slice().sort((a, b) => a.email.localeCompare(b.email)),
      groups: (r.groups || []).slice().sort((a, b) => String(a.groupId).localeCompare(String(b.groupId))),
    });
    const sStr = JSON.stringify(norm(serial));
    const pStr = JSON.stringify(norm(parallel));
    check('parallel aggregates == serial aggregates (deep equal)', sStr === pStr);
    if (sStr !== pStr) {
      console.log('SERIAL  : ' + sStr);
      console.log('PARALLEL: ' + pStr);
    }
    // DEV class also contains paul.ivers (seeded by devSeedDevProject), so ≥3.
    check('the 3 seeded students are aggregated',
      emails.every((e) => serial.students.some((s) => s.email.toLowerCase() === e)));
    check('1 group aggregated', serial.groups.length === 1);
  } finally {
    try {
      resetGroupSheetCache_();
      const groups = listGroupsForProject_(project, 'DEV');
      groups.forEach((g) => { try { consoleGroupDisband(project.projectId, g.groupId); } catch (e) {} });
    } catch (e) {}
    emails.forEach((e) => { try { forgetSoloSheetId_(project.projectId, e); } catch (x) {} });
    devGroupsTestCleanup_(emails);
  }
  console.log(state.pass + '/' + (state.pass + state.fail) + ' passed');
  return state;
}

/** Run both dashboard-perf tests; print a single GREEN/NOT-GREEN summary. */
function devTestDashboardPerfAll() {
  const tests = [
    ['devTestSheetManifestRoundTrip',          devTestSheetManifestRoundTrip],
    ['devTestDashboardParityParallelVsSerial', devTestDashboardParityParallelVsSerial],
  ];
  let pass = 0, fail = 0, threw = 0;
  const lines = [];
  tests.forEach((entry) => {
    try {
      const s = entry[1]() || {};
      const p = s.pass || 0, f = s.fail || 0;
      pass += p; fail += f;
      lines.push((f === 0 ? 'PASS  ' : 'FAIL  ') + entry[0] + '  (' + p + '/' + (p + f) + ')');
    } catch (e) {
      threw++;
      lines.push('THREW ' + entry[0] + '  — ' + (e && e.message || e));
    }
  });
  const ok = (fail === 0 && threw === 0);
  console.log('===== devTestDashboardPerfAll =====\n' + lines.join('\n') +
    '\n-----------------------------------\nTOTAL ' + pass + ' passed, ' + fail +
    ' failed, ' + threw + ' threw  →  ' + (ok ? 'ALL GREEN' : 'NOT GREEN'));
  return { ok, pass, fail, threw };
}
