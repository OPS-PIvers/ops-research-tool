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
