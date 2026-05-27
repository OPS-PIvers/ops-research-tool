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
    appendRow_(rosterTab, HEADERS.ROSTER, { Name: 'Dev Owner', Email: me, Class: 'DEV', Teacher: me });
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
