/**
 * Editor-callable test helpers — Phase 1 sanity checks.
 * Run any of these from the Apps Script editor to exercise the backend
 * without standing up the extension. Safe on real config; writes go to
 * a "Dev" project unless you point them elsewhere.
 */

/**
 * Diagnose the Docs sidebar "Could not load project data." failure. Runs the
 * exact server path sidebarGetProjectData uses, under the caller's identity,
 * and reports where it breaks — including a JSON.stringify pass (the client
 * gets null if the payload can't be delivered) and a scan for Date-typed cells
 * (a common google.script.run delivery gotcha). Run from the editor; the return
 * string also lands in the execution log.
 */
function devDiagnoseSidebarData() {
  const out = [];
  const log = (m) => { out.push(String(m)); console.log(String(m)); };
  try {
    const actor = getActorEmail_();
    log('actorEmail = "' + actor + '"');
    const project = devSeedDevProject();
    log('project: id=' + project.projectId + ' name="' + project.name +
        '" bundleId=' + project.bundleId + ' rootFolderId=' + project.rootFolderId);

    let rawS = null, rawH = null;
    try { rawS = readSourcesForActor_(actor, project.projectId); log('readSourcesForActor_ OK, count=' + rawS.length); }
    catch (e) { log('readSourcesForActor_ THREW: ' + (e && e.stack || e)); }
    try { rawH = readHighlightsForActor_(actor, project.projectId); log('readHighlightsForActor_ OK, count=' + rawH.length); }
    catch (e) { log('readHighlightsForActor_ THREW: ' + (e && e.stack || e)); }

    let data = null;
    try {
      data = sidebarGetProjectData(project.projectId);
      log('sidebarGetProjectData returned ok=' + (data && data.ok) +
          (data && data.error ? ' error="' + data.error + '"' : '') +
          ' sources=' + (data && data.sources ? data.sources.length : 'n/a') +
          ' highlights=' + (data && data.highlights ? data.highlights.length : 'n/a'));
    } catch (e) { log('sidebarGetProjectData THREW: ' + (e && e.stack || e)); }

    if (data) {
      try { log('JSON.stringify OK, length=' + JSON.stringify(data).length); }
      catch (e) { log('JSON.stringify THREW (payload not serializable!): ' + (e && e.message || e)); }
      const dateHits = [];
      (data.sources || []).concat(data.highlights || []).forEach((row, i) => {
        Object.keys(row || {}).forEach((k) => { if (row[k] instanceof Date) dateHits.push('[' + i + '].' + k); });
      });
      log('Date-typed cells in payload: ' + (dateHits.length ? dateHits.join(', ') : 'none'));
    }
  } catch (e) {
    log('TOP-LEVEL THREW: ' + (e && e.stack || e));
  }
  const report = out.join('\n');
  return report;
}

/** Create a dev project + a fake roster entry for the current owner so writes can flow. */
function devSeedDevProject() {
  const me = Session.getEffectiveUser().getEmail();

  // Add owner to the roster as a fake student in class "DEV" (Classes v2).
  ensureClassSchema_();
  if (!getClassRecord_('DEV')) createClass_('DEV', me, '');
  if (!getStudentIdentity_(me)) upsertStudent_({ ID: '', First: 'Dev', Last: 'Owner', Email: me });
  enroll_(me, 'DEV');

  // Add owner to staff as admin if missing.
  const rosterSs = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  const staffTab = getTab_(rosterSs, TABS.STAFF);
  if (findRowByKey_(staffTab, HEADERS.STAFF, 'Email', me) < 0) {
    appendRow_(staffTab, HEADERS.STAFF, { Name: 'Dev Owner', Email: me, Role: ROLES.ADMIN });
    invalidateStaffCache_();
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

/**
 * Regression lock for the "blank citation in the annotated bibliography" bug.
 * A source with citationFields '{}' but populated scraped* columns (the common
 * case: student highlighted + classified + annotated but never opened the
 * citation form) MUST still render a real citation. The bug was a same-named
 * `parseCitationFields_` in 62_aggregator.js shadowing 52's richer
 * buildCitationFields_ (GAS shares one global namespace; 62 loads last), which
 * dropped the scraped fallback so those sources inserted as blank lines.
 *
 * Asserts: buildCitationFields_ fills from scraped* and formats non-empty; the
 * RAW parseCitationFields_ deliberately does NOT (it backs the completion
 * metric). Pure — no Sheet I/O. Run from the editor.
 */
function devTestBibliographyCitationFallback() {
  const out = [];
  let pass = true;
  const check = (name, cond) => { out.push((cond ? 'PASS' : 'FAIL') + ' — ' + name); if (!cond) pass = false; };

  // Mirrors the real EBSCO row: citationFields '{}', data only in scraped*.
  const scrapedOnly = {
    citationFields: '{}',
    scrapedTitle: 'U.S. Civil War.',
    scrapedSite: 'Salem Press Encyclopedia',
    scrapedDate: '20230430',
    scrapedAuthor: 'Hylton, Raymond Pierre',
    sourceType: 'article',
    rawUrl: 'https://research-ebsco-com.content.elibrarymn.org/c/viartl/viewer/html/nycc7ixfoj',
  };

  const built = buildCitationFields_(scrapedOnly);
  check('buildCitationFields_ falls back title from scrapedTitle', built.title === 'U.S. Civil War.');
  check('buildCitationFields_ falls back url from rawUrl', !!built.url);
  check('buildCitationFields_ falls back author from scrapedAuthor', built.author === 'Hylton, Raymond Pierre');

  const formatted = formatCitation(built, 'mla');
  check('formatCitation on scraped-only source is NON-empty', !!(formatted.text && formatted.text.length));
  out.push('   rendered: ' + JSON.stringify(formatted.text));

  // The completion-metric parser must stay raw (no scraped fallback) so an
  // unedited source counts as citation-INCOMPLETE on the dashboard.
  const raw = parseCitationFields_(scrapedOnly);
  check('raw parseCitationFields_ does NOT fall back (title undefined)', !raw.title);
  check('raw parseCitationFields_ does NOT fall back (url undefined)', !raw.url);

  out.push(pass ? 'ALL GREEN' : 'NOT GREEN');
  const report = out.join('\n');
  console.log(report);
  return report;
}

/**
 * Locks the pasted-citation override, citation link ranges, the "cleared field
 * stays cleared" precedence, and pasted-counts-as-cited. Editor mirror of
 * apps-script/test/citation.node.test.js (run that headless). Pure.
 */
function devTestCitationOverrides() {
  const out = [];
  let pass = true;
  const check = (name, cond) => { out.push((cond ? 'PASS' : 'FAIL') + ' — ' + name); if (!cond) pass = false; };

  const pastedText = 'Spector, Ronald H. "Vietnam War." Encyclopedia Britannica, 2024, www.britannica.com/event/Vietnam-War.';
  const src = {
    citationFields: JSON.stringify({ author: '', pasted: { text: pastedText, italics: [[34, 57]] } }),
    scrapedAuthor: 'Wrong Scrape', scrapedTitle: 'Vietnam War', rawUrl: 'https://www.britannica.com/event/Vietnam-War',
  };
  const fields = buildCitationFields_(src);
  check('cleared author is not re-filled from the scrape', fields.author === '');
  const f = formatCitation(fields, 'mla');
  check('pasted citation wins', f.pasted === true && f.text === pastedText);
  check('pasted italics kept', JSON.stringify(f.italics) === '[[34,57]]');
  check('URL in pasted citation is linked', f.links.length === 1 && f.links[0][2] === 'https://www.britannica.com/event/Vietnam-War');
  check('pasted counts as cited', isCitationComplete_(parseCitationFields_(src)) === true);

  const built = formatCitation({ sourceType: 'website', title: 'Agent Orange', url: 'https://www.history.com/x' }, 'mla');
  const l = built.links[0];
  check('built citation links its URL', !!l && built.text.slice(l[0], l[1]) === 'https://www.history.com/x');
  check('title alone is not cited', isCitationComplete_({ title: 'T' }) === false);

  out.push(pass ? 'ALL GREEN' : 'NOT GREEN');
  const report = out.join('\n');
  console.log(report);
  return report;
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

function devTestProjectRequirementsParse() {
  let pass = 0, fail = 0;
  const check = (l, c) => { if (c) { pass++; console.log('PASS ' + l); } else { fail++; console.log('FAIL ' + l); } };

  const a = parseProjectRequirements_({});
  check('empty → minSources null',            a.minSources === null);
  check('empty → minHighlights null',         a.minHighlightsPerSource === null);
  check('empty → minDistinct null',           a.minDistinctCategories === null);
  check('empty → requireAnnotation true',     a.requireAnnotation === true);

  const b = parseProjectRequirements_({ requirements: JSON.stringify({
    minSources: 5, minHighlightsPerSource: 3, minDistinctCategories: 2, requireAnnotation: false }) });
  check('parsed minSources 5',                b.minSources === 5);
  check('parsed minHighlights 3',             b.minHighlightsPerSource === 3);
  check('parsed minDistinct 2',               b.minDistinctCategories === 2);
  check('parsed requireAnnotation false',     b.requireAnnotation === false);

  const c = parseProjectRequirements_({ requirements: JSON.stringify({
    minDistinctCategories: 9, minSources: 0, minHighlightsPerSource: -2 }) });
  check('minDistinct capped at 5',            c.minDistinctCategories === 5);
  check('minSources 0 → null',                c.minSources === null);
  check('negative minHighlights → null',      c.minHighlightsPerSource === null);

  const d = parseProjectRequirements_({ requirements: 'not json' });
  check('malformed → defaults',               d.minSources === null && d.requireAnnotation === true);

  console.log(pass + '/' + (pass + fail) + ' passed');
}

function devTestCompletionRespectsAnnotationToggle() {
  let pass = 0, fail = 0;
  const check = (l, c) => { if (c) { pass++; console.log('PASS ' + l); } else { fail++; console.log('FAIL ' + l); } };
  const sources = [
    { sourceId: 's1', primarySecondary: 'primary',   annotation: '', citationFields: JSON.stringify({ title: 'A', url: 'u' }) },
    { sourceId: 's2', primarySecondary: 'secondary', annotation: '', citationFields: JSON.stringify({ title: 'B', url: 'u' }) },
  ];
  const on  = computeCompletionSummary_(sources, parseProjectRequirements_({}));
  check('annotations required → 0 complete', on.complete === 0);
  const off = computeCompletionSummary_(sources, parseProjectRequirements_({ requirements: JSON.stringify({ requireAnnotation: false }) }));
  check('annotations optional → 2 complete', off.complete === 2);
  check('annotations optional → 100%',       off.percent === 100);
  console.log(pass + '/' + (pass + fail) + ' passed');
}

function devTestEvidenceDepth() {
  let pass = 0, fail = 0;
  const check = (l, c) => { if (c) { pass++; console.log('PASS ' + l); } else { fail++; console.log('FAIL ' + l); } };
  const sources = [{ sourceId: 's1' }, { sourceId: 's2' }, { sourceId: 's3' }];
  const highlights = [
    { sourceId: 's1', primaryCategory: 'A' }, { sourceId: 's1', primaryCategory: 'B' }, { sourceId: 's1', primaryCategory: 'A' }, // s1: 3 hl, 2 cats
    { sourceId: 's2', primaryCategory: 'A' }, // s2: 1 hl, 1 cat
    // s3: nothing
  ];
  const d = computeEvidenceDepth_(sources, highlights, { minHighlightsPerSource: 2, minDistinctCategories: 2 });
  check('targetSet true',            d.targetSet === true);
  check('total 3',                   d.total === 3);
  check('s1 highlightCount 3',       d.perSource[0].highlightCount === 3);
  check('s1 distinct 2',             d.perSource[0].distinctCategoryCount === 2);
  check('s1 meets',                  d.perSource[0].meets === true);
  check('s2 fails (1hl,1cat)',       d.perSource[1].meets === false);
  check('s3 fails (empty)',          d.perSource[2].meets === false);
  check('sourcesMeeting 1',          d.sourcesMeeting === 1);

  const none = computeEvidenceDepth_(sources, highlights, {});
  check('no target → targetSet false', none.targetSet === false);
  check('no target → all meet',        none.sourcesMeeting === 3);

  const onlyH = computeEvidenceDepth_(sources, highlights, { minHighlightsPerSource: 2 });
  check('onlyH: s1 meets',           onlyH.perSource[0].meets === true);
  check('onlyH: s2 fails',           onlyH.perSource[1].meets === false);
  console.log(pass + '/' + (pass + fail) + ' passed');
}

function devTestSourcesProgress() {
  let pass = 0, fail = 0;
  const check = (l, c) => { if (c) { pass++; console.log('PASS ' + l); } else { fail++; console.log('FAIL ' + l); } };
  const three = [{ sourceId: 'a' }, { sourceId: 'b' }, { sourceId: 'c' }];
  const p1 = computeSourcesProgress_(three, { minSources: 5 });
  check('3 of 5 → not meets', p1.meets === false && p1.sourceCount === 3 && p1.minSources === 5);
  const p2 = computeSourcesProgress_(three, { minSources: 3 });
  check('3 of 3 → meets',     p2.meets === true);
  const p3 = computeSourcesProgress_(three, {});
  check('no target → meets, null', p3.meets === true && p3.minSources === null);
  console.log(pass + '/' + (pass + fail) + ' passed');
}

function devTestRequirementsBackCompat() {
  let pass = 0, fail = 0;
  const check = (l, c) => { if (c) { pass++; console.log('PASS ' + l); } else { fail++; console.log('FAIL ' + l); } };
  const bundle = { bundleId: 'b', name: 'B', style: 'mla',
    label1: 'Background', color1: '#1', label2: 'Build-Up', color2: '#2',
    label3: 'Main Event', color3: '#3', label4: 'Short', color4: '#4', label5: 'Long', color5: '#5' };
  const sources = [
    { sourceId: 's1', primarySecondary: 'primary',   annotation: 'Good.', citationFields: JSON.stringify({ title: 'A', url: 'https://a' }), createdAt: '2026-05-20T10:00:00Z' },
    { sourceId: 's2', primarySecondary: 'secondary', annotation: '',      citationFields: JSON.stringify({ title: 'B', url: 'https://b' }), createdAt: '2026-05-21T10:00:00Z' },
    { sourceId: 's3', primarySecondary: 'unset',     annotation: 'N.',    citationFields: JSON.stringify({ title: '', url: '' }),          createdAt: '2026-05-22T10:00:00Z' },
  ];
  const highlights = [{ sourceId: 's1', primaryCategory: 'Background', createdAt: '2026-05-20T11:00:00Z' }];
  const agg = aggregateStudent_(sources, highlights, bundle);   // NO requirements arg
  check('completion.complete still 1',  agg.completion.complete === 1);
  check('completion.percent still 33',  agg.completion.percent === 33);
  check('gaps.annotation still 1',      agg.gaps.annotation === 1);
  check('sourcesProgress inert',        agg.sourcesProgress.meets === true && agg.sourcesProgress.minSources === null);
  check('evidenceDepth inert',          agg.evidenceDepth.targetSet === false);
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

  // Snapshot the CURRENT roster from the v2 model (not the stale legacy tab) so
  // the restore in `finally` puts back exactly what was there.
  const before = currentFlatRoster_();
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
 * Classes v2: the legacy→normalized migration transform + that ensureClassSchema_
 * stands up the Students/Classes/Enrollments tabs. The pure transform is also
 * covered by apps-script/test/roster_model.node.test.js; this re-asserts it
 * in-engine and checks the live tabs exist.
 */
function devTestClassSchemaMigration() {
  const checks = [];
  const check = (label, ok) => { checks.push({ label, ok }); };
  const built = buildClassSchemaFromLegacy_([
    { ID: '1', First: 'A', Last: 'A', Email: 'a@x.org', Class: 'C1', TeacherEmail: 't1@x.org' },
    { ID: '1', First: 'A', Last: 'A', Email: 'a@x.org', Class: 'C2', TeacherEmail: 't2@x.org' },
    { ID: '2', First: 'B', Last: 'B', Email: 'b@x.org', Class: 'C1', TeacherEmail: '' },
  ]);
  check('students deduped by email (2)', built.students.length === 2);
  check('multi-class student kept once', built.students.filter((s) => s.Email === 'a@x.org').length === 1);
  check('2 classes', built.classes.length === 2);
  check('C1 teacher from first row', (built.classes.find((c) => c.Class === 'C1') || {}).TeacherEmail === 't1@x.org');
  check('3 enrollments', built.enrollments.length === 3);

  ensureClassSchema_();
  const ss = SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID);
  check('Students tab exists', !!ss.getSheetByName(TABS.STUDENTS));
  check('Classes tab exists', !!ss.getSheetByName(TABS.CLASSES));
  check('Enrollments tab exists', !!ss.getSheetByName(TABS.ENROLLMENTS));

  const pass = checks.every((c) => c.ok);
  console.log(JSON.stringify({ ok: pass, checks }, null, 2));
  return { ok: pass };
}

/**
 * Classes v2 keystone: a student in MULTIPLE classes sees every project any of
 * their classes is in, and has exactly ONE Sheet per project regardless of how
 * many classes they're in (class-agnostic lookup never orphans/duplicates).
 * Seeds + cleans up after itself (trashes the provisioned Sheet, drops the
 * student + scratch classes).
 */
function devTestMultiClassEnrollment() {
  const checks = [];
  const check = (label, ok) => { checks.push({ label, ok }); };
  const project = devSeedDevProject();   // covers class DEV
  const se = 'multiclass.student@orono.k12.mn.us';
  ensureClassSchema_();
  ['MCA', 'MCB'].forEach((c) => { if (!getClassRecord_(c)) createClass_(c, getActorEmail_(), ''); });
  upsertStudent_({ ID: '', First: 'Multi', Last: 'Class', Email: se });
  try {
    enroll_(se, 'DEV');
    enroll_(se, 'MCA');
    check('enrolled in DEV + MCA',
      JSON.stringify(getStudentClasses_(se).sort()) === JSON.stringify(['DEV', 'MCA']));

    const elig = studentEligibleProjects_(getStudentClasses_(se), [
      { name: 'P-DEV', memberClasses: 'DEV' },
      { name: 'P-MCA', memberClasses: 'MCA,OTHER' },
      { name: 'P-NONE', memberClasses: 'ZZZ' },
    ]).map((p) => p.name).sort();
    check('eligible for both classes\' projects',
      JSON.stringify(elig) === JSON.stringify(['P-DEV', 'P-MCA']));

    // One Sheet per (student, project) even as classes are added afterward.
    const s1 = findOrCreateSoloSheet_(se, project);
    enroll_(se, 'MCB');                       // add a 3rd class AFTER the Sheet exists
    const s2 = findOrCreateSoloSheet_(se, project);
    check('one Sheet per project across classes', s1.getId() === s2.getId());

    const s3 = getSoloSheetIfExists_(se, project);
    check('read path resolves the same Sheet', !!s3 && s3.getId() === s1.getId());
  } finally {
    try {
      const ss = getSoloSheetIfExists_(se, project);
      if (ss) { DriveApp.getFileById(ss.getId()).setTrashed(true); forgetSoloSheetId_(project.projectId, se); }
    } catch (e) {}
    try { deleteStudent_(se); } catch (e) {}
    ['MCA', 'MCB'].forEach((c) => { try { deleteClass_(c); } catch (e) {} });
  }
  const pass = checks.every((c) => c.ok);
  console.log(JSON.stringify({ ok: pass, checks }, null, 2));
  return { ok: pass };
}

/**
 * Bulk paste-to-enroll: creates new students (with names), enrolls an existing
 * student (email-only), counts already-enrolled, and reports per-row errors for
 * a blank email and an unknown email with no name. Cleans up the new students.
 */
function devTestBulkEnroll() {
  const checks = [];
  const check = (label, ok) => { checks.push({ label, ok }); };
  devSeedDevProject();          // ensures the DEV class + the actor enrolled in it
  ensureClassSchema_();
  const e1 = 'bulk.one@orono.k12.mn.us';
  const e2 = 'bulk.two@orono.k12.mn.us';
  const me = getActorEmail_();
  try {
    const resp = adminBulkEnroll('DEV', [
      { First: 'Bulk', Last: 'One', Email: e1 },
      { First: 'Bulk', Last: 'Two', Email: e2 },
      { Email: me },                                  // existing + already in DEV
      { First: 'No', Last: 'Email', Email: '' },      // error: blank email
      { Email: 'unknown.person@orono.k12.mn.us' },    // error: unknown, no name
    ]);
    check('created 2 new students', resp.created === 2);
    check('enrolled 2 new', resp.enrolled === 2);
    check('1 already enrolled', resp.alreadyEnrolled === 1);
    check('2 rows errored', resp.errors.length === 2);
    check('e1 enrolled in DEV', getStudentClasses_(e1).indexOf('DEV') >= 0);
    check('e2 student created', !!getStudentIdentity_(e2));
    const again = adminBulkEnroll('DEV', [{ Email: e1 }, { Email: e2 }]);
    check('idempotent re-run enrolls 0', again.enrolled === 0 && again.alreadyEnrolled === 2);
  } finally {
    try { deleteStudent_(e1); } catch (e) {}
    try { deleteStudent_(e2); } catch (e) {}
  }
  const pass = checks.every((c) => c.ok);
  console.log(JSON.stringify({ ok: pass, checks }, null, 2));
  return { ok: pass };
}

/**
 * Locks the solo-Sheet naming + lookup invariant (pure — no Drive): the
 * friendly file name keeps the email as its trailing token, and
 * soloSheetNameMatches_ resolves both the legacy bare-email name and the new
 * "<project> — Research — <email>" name while refusing a longer-local-part
 * near-match, a different email, and a group sheet.
 */
function devTestSoloSheetNaming() {
  const checks = [];
  const check = (label, ok) => { checks.push({ label, ok }); };
  const e = 'jo.smith@orono.k12.mn.us';

  check('name format',                soloSheetName_('Dev Project', e) === 'Dev Project — Research — ' + e);
  check('name lowercases email',      soloSheetName_('P', 'A@B.K12.MN.US') === 'P — Research — a@b.k12.mn.us');
  check('matches legacy bare email',  soloSheetNameMatches_(e, e) === true);
  check('matches new format',         soloSheetNameMatches_('Dev Project — Research — ' + e, e) === true);
  check('matches case-insensitively', soloSheetNameMatches_('Dev Project — Research — JO.SMITH@ORONO.K12.MN.US', e) === true);
  check('rejects longer local part',  soloSheetNameMatches_('bob' + e, e) === false);
  check('rejects different email',     soloSheetNameMatches_('Dev Project — Research — al.jones@orono.k12.mn.us', e) === false);
  check('rejects group sheet',        soloSheetNameMatches_('[grp] History trio', e) === false);

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
  ensureClassSchema_();
  if (!getClassRecord_('DEV')) createClass_('DEV', me, '');
  const emails = [];
  for (let i = 1; i <= count; i++) {
    const email = 'devgroups.student' + i + '@orono.k12.mn.us';
    emails.push(email);
    if (!getStudentIdentity_(email)) upsertStudent_({ ID: '', First: 'DevG' + i, Last: 'Student', Email: email });
    enroll_(email, 'DEV');
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

  // Remove students (identity + enrollments).
  ensureClassSchema_();
  emails.forEach((email) => {
    if (getStudentIdentity_(email)) { try { deleteStudent_(email); } catch (e) {} }
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
    resetGroupSheetCache_(); bumpSheetRefVersion_();
    const merge = consoleGroupCreate(project.projectId, 'RoutingProbe', emails);
    check('merge ok', merge && merge.ok === true);
    check('groupId present', !!merge.groupId);
    check('group Sheet ID returned', !!merge.groupSheetId);

    // Solo Sheets are trashed on merge — the group Sheet is the sole store.
    const projectFolder = DriveApp.getFolderById(project.rootFolderId);
    const classFolder = findChildFolder_(projectFolder, 'DEV');
    check('no solo Sheets remain at class root',
      emails.every((e) => findChildFile_(classFolder, e) === null));

    resetGroupSheetCache_(); bumpSheetRefVersion_();
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
      resetGroupSheetCache_(); bumpSheetRefVersion_();
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
    resetGroupSheetCache_(); bumpSheetRefVersion_();
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
    resetGroupSheetCache_(); bumpSheetRefVersion_();
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
      resetGroupSheetCache_(); bumpSheetRefVersion_();
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

    resetGroupSheetCache_(); bumpSheetRefVersion_();
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
    resetGroupSheetCache_(); bumpSheetRefVersion_();
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
    resetGroupSheetCache_(); bumpSheetRefVersion_();
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
    resetGroupSheetCache_(); bumpSheetRefVersion_();
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
    resetGroupSheetCache_(); bumpSheetRefVersion_();
    check('C no longer grouped', findGroupSheetForStudent_(emails[2], project) === null);
  } finally {
    try {
      resetGroupSheetCache_(); bumpSheetRefVersion_();
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

    resetGroupSheetCache_(); bumpSheetRefVersion_();
    const g = consoleGroupCreate(project.projectId, 'AddProbe', [emails[0], emails[1]]);
    const added = consoleAddToGroup(project.projectId, g.groupId, emails[2]);
    check('add ok', added && added.ok === true);
    check('C source copied in', added.copiedSources === 1);
    check('C highlight copied in', added.copiedHighlights === 1);

    resetGroupSheetCache_(); bumpSheetRefVersion_();
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
      resetGroupSheetCache_(); bumpSheetRefVersion_();
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
  const emails = devGroupsSeedRoster_(5);   // 5 DEV students; [3],[4] stay free for the scope test
  const me = Session.getEffectiveUser().getEmail();
  ensureClassSchema_();
  // DEV2 class owned by a different teacher, with two students (Classes v2).
  if (!getClassRecord_('DEV2')) createClass_('DEV2', 'somebody.else@orono.k12.mn.us', '');
  const dev2 = ['devgroups.dev2a@orono.k12.mn.us', 'devgroups.dev2b@orono.k12.mn.us'];
  dev2.forEach((e, i) => {
    if (!getStudentIdentity_(e)) upsertStudent_({ ID:'', First:'DG2'+i, Last:'Student', Email:e });
    enroll_(e, 'DEV2');
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

    // Teacher-out-of-scope: demote actor to teacher AND reassign DEV's teacher to
    // a phantom (so listClassesTaughtBy_(me) is empty), then merging two free DEV
    // students must throw — the actor teaches nothing.
    const staffTab = getTab_(SpreadsheetApp.openById(CONFIG.ROSTER_SHEET_ID), TABS.STAFF);
    const sIdx = findRowByKey_(staffTab, HEADERS.STAFF, 'Email', me);
    const roleCol = HEADERS.STAFF.indexOf('Role') + 1;
    const origRole = staffTab.getRange(sIdx, roleCol).getValue();
    const origTeacher = getClassRecord_('DEV').TeacherEmail;
    staffTab.getRange(sIdx, roleCol).setValue(ROLES.TEACHER);
    updateClass_('DEV', { TeacherEmail: 'phantom.teacher@orono.k12.mn.us' });
    try {
      let scopeThrew = false;
      try { consoleGroupCreate(project.projectId, 'OutOfScope', [emails[3], emails[4]]); }
      catch (e) { scopeThrew = true; }
      check('teacher out-of-scope throws', scopeThrew);
    } finally {
      updateClass_('DEV', { TeacherEmail: origTeacher });
      staffTab.getRange(sIdx, roleCol).setValue(origRole);
    }

    // Disband the AlreadyInGroup group before cleanup.
    try { consoleGroupDisband(project.projectId, g.groupId); } catch (e) {}
  } finally {
    dev2.forEach((e) => { if (getStudentIdentity_(e)) { try { deleteStudent_(e); } catch (err) {} } });
    try { deleteClass_('DEV2'); } catch (e) {}
    try {
      resetGroupSheetCache_(); bumpSheetRefVersion_();
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
// Teacher "Manage roster" (68_teacher_roster.js)
// ============================================================

/**
 * Pure auth/normalization checks + a live DEV round trip: unenroll a grouped
 * student (group exit runs first → solo Sheet rebuilt, 2-member group
 * auto-disbands), re-enroll by a messy-cased email, and confirm the SAME solo
 * Sheet resolves again (Sheets are kept on remove). Runs as the editor user
 * (admin via devSeedDevProject). Node twin: test/teacher_roster.node.test.js.
 */
function devTestTeacherRoster() {
  const project = devSeedDevProject();
  const emails = devGroupsSeedRoster_(2);
  const { check, state } = devGroupsChecker_();
  try {
    check('teacher owns class', canEditClassRoster_('t@x.org', false, { Class: 'C', TeacherEmail: 'T@x.org' }));
    check('teacher refused on another class', !canEditClassRoster_('t@x.org', false, { Class: 'C', TeacherEmail: 'u@x.org' }));
    check('admin allowed', canEditClassRoster_('a@x.org', true, { Class: 'C', TeacherEmail: 'u@x.org' }));
    check('unknown class refused', !canEditClassRoster_('a@x.org', true, null));

    const bundle = listBundles_().find((b) => b.bundleId === project.bundleId);
    const a = emails[0];
    const aSheet = findOrCreateStudentSheet_(a, project);
    upsertSource_(aSheet, {
      sourceId: 'tr-src-' + a, projectId: project.projectId,
      rawUrl: 'https://devtr.example.com/' + a, scrapedTitle: 'tr', createdByEmail: a,
    });
    upsertHighlight_(aSheet, {
      highlightId: 'tr-hl-' + a, sourceId: 'tr-src-' + a, projectId: project.projectId,
      primaryCategory: bundle.label1, highlightedText: 'tr', createdByEmail: a,
    });
    resetGroupSheetCache_(); bumpSheetRefVersion_();
    const g = consoleGroupCreate(project.projectId, 'RosterProbe', emails);
    check('fixture group created', g && g.ok === true);

    const roster = consoleGetClassRoster('DEV');
    check('roster lists the student', roster.students.some((s) => s.email === a));

    const rm = consoleUnenrollStudentFromClass('DEV', a);
    check('unenroll removed 1 row', rm.removed === 1);
    check('left the group first', rm.leftGroups.length === 1 && rm.leftGroups[0].groupId === g.groupId);
    check('2-member group auto-disbanded', rm.leftGroups[0].autoDisbanded === true);
    check('roster no longer lists them', !rm.students.some((s) => s.email === a));
    resetGroupSheetCache_();
    const solo = findSoloSheetInProject_(a, project);
    check('solo Sheet rebuilt + kept', !!solo);
    const soloId = solo && solo.getId();
    check('their highlight followed them out', !!solo && readAllAsObjects_(getTab_(solo, TABS.HIGHLIGHTS), HEADERS.HIGHLIGHTS)
      .some((h) => h.highlightId === 'tr-hl-' + a));
    check('remove is idempotent', consoleUnenrollStudentFromClass('DEV', a).removed === 0);

    const nf = consoleEnrollStudentInClass('DEV', 'nobody.here.zz@orono.k12.mn.us');
    check('unknown email → not_found', nf.ok === false && nf.reason === 'not_found');
    const add = consoleEnrollStudentInClass('DEV', '  ' + a.toUpperCase() + ' ');
    check('re-enroll by messy-cased email', add.ok === true && add.alreadyEnrolled === false &&
      getStudentClasses_(a).indexOf('DEV') >= 0);
    check('already enrolled reported', consoleEnrollStudentInClass('DEV', a).alreadyEnrolled === true);
    const again = findSoloSheetInProject_(a, project);
    check('re-enroll resolves the SAME Sheet', !!again && again.getId() === soloId);

    const audit = listAuditEventsForProject_('').filter((e) => String(e.detail).indexOf('email=' + a) >= 0);
    check('audit: enroll + unenroll written',
      audit.some((e) => e.action === AUDIT_ACTIONS.ROSTER_ENROLL) &&
      audit.some((e) => e.action === AUDIT_ACTIONS.ROSTER_UNENROLL));
  } finally {
    try {
      resetGroupSheetCache_(); bumpSheetRefVersion_();
      listGroupsForProject_(project, 'DEV').forEach((g) => { try { consoleGroupDisband(project.projectId, g.groupId); } catch (e) {} });
    } catch (e) {}
    emails.forEach((e) => {   // friendly-named solos aren't matched by the cleanup's exact-name walk
      try {
        const ss = findSoloSheetInProject_(e, project);
        if (ss) { DriveApp.getFileById(ss.getId()).setTrashed(true); forgetSoloSheetId_(project.projectId, e); }
      } catch (err) {}
    });
    devGroupsTestCleanup_(emails);
  }
  console.log('devTestTeacherRoster' + state.pass + '/' + (state.pass + state.fail) + ' passed');
  return state;
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
 * Locks the quoted-title punctuation rule (quotedTitleMLA_): a title that
 * already ends in '.', '?', or '!' keeps that single mark inside the closing
 * quote; any other title gets a period added. Guards against the double-period
 * regression ("U.S. Civil War." → "U.S. Civil War..") across the three
 * quoted-title source types (website / article / primary). Pure — no Sheet I/O.
 */
function devTestMlaTitlePunctuation() {
  // [sourceType, title, expected substring that MUST appear in the citation]
  const cases = [
    ['website', 'U.S. Civil War.',  '"U.S. Civil War."'],   // trailing '.' not doubled
    ['article', 'U.S. Civil War.',  '"U.S. Civil War."'],
    ['primary', 'U.S. Civil War.',  '"U.S. Civil War."'],
    ['website', 'What Happened?',   '"What Happened?"'],     // '?' kept, no added '.'
    ['website', 'Stop!',            '"Stop!"'],              // '!' kept, no added '.'
    ['website', 'Civil War Facts',  '"Civil War Facts."'],   // no terminal punct → period added
    ['website', '  Trailing Space ', '"Trailing Space."'],   // trimmed, then period
  ];
  let pass = 0, fail = 0;
  cases.forEach(([sourceType, title, expectSub]) => {
    const got = formatCitation({ sourceType, title, url: 'https://x.example.com/p' }, 'mla').text;
    const ok = got.indexOf(expectSub) >= 0 && got.indexOf('..') < 0;
    if (ok) pass++; else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${sourceType} ${JSON.stringify(title)} -> ${JSON.stringify(got)} (want substring ${JSON.stringify(expectSub)}, no "..")`);
  });
  console.log((fail === 0 ? 'devTestMlaTitlePunctuation: ALL GREEN' : 'devTestMlaTitlePunctuation: NOT GREEN (' + fail + ' fail)') + ` — ${pass} passed`);
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
    resetGroupSheetCache_(); bumpSheetRefVersion_();

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
    resetGroupSheetCache_(); bumpSheetRefVersion_();
    const merge = consoleGroupCreate(project.projectId, 'ParityProbe', [emails[0], emails[1]]);
    check('merge ok', merge && merge.ok === true);

    SpreadsheetApp.flush();   // ensure the Sheets REST read sees all the writes

    const scoped = ['DEV'];
    resetGroupSheetCache_(); bumpSheetRefVersion_();
    const serial = computeDashboardSerial_(project, scoped, bundle);
    resetGroupSheetCache_(); bumpSheetRefVersion_();
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
      resetGroupSheetCache_(); bumpSheetRefVersion_();
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

/**
 * Test-only teardown: hard-delete a Bundles registry row by id. Bundles are
 * production-immutable (no deleter ships), so this lives in 99_dev.js purely so
 * devTestConsoleCreateBundle doesn't pollute the real picker with test sets.
 */
function devDeleteBundleRow_(bundleId) {
  const ss = SpreadsheetApp.openById(CONFIG.BUNDLES_SHEET_ID);
  const tab = getTab_(ss, TABS.BUNDLES);
  const idCol = HEADERS.BUNDLES.indexOf('bundleId') + 1;
  const last = tab.getLastRow();
  for (let r = last; r >= 2; r--) {
    if (String(tab.getRange(r, idCol).getValue()) === String(bundleId)) {
      tab.deleteRow(r);
      return true;
    }
  }
  return false;
}

function devTestRequirementsValidation() {
  let pass = 0, fail = 0;
  const check = (l, c) => { if (c) { pass++; console.log('PASS ' + l); } else { fail++; console.log('FAIL ' + l); } };
  const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };

  const ok = validateRequirementsInput_({ minSources: '5', minHighlightsPerSource: 3, minDistinctCategories: 2, requireAnnotation: false });
  check('coerces "5" → 5',              ok.minSources === 5);
  check('keeps requireAnnotation false', ok.requireAnnotation === false);

  const blank = validateRequirementsInput_({ minSources: '', requireAnnotation: true });
  check('blank minSources omitted',     blank.minSources === undefined);
  check('default requireAnnotation true', blank.requireAnnotation === true);

  check('rejects minSources 0',         throws(() => validateRequirementsInput_({ minSources: 0 })));
  check('rejects negative',             throws(() => validateRequirementsInput_({ minHighlightsPerSource: -1 })));
  check('rejects minDistinct 6',        throws(() => validateRequirementsInput_({ minDistinctCategories: 6 })));
  check('rejects non-numeric',          throws(() => validateRequirementsInput_({ minSources: 'lots' })));
  console.log(pass + '/' + (pass + fail) + ' passed');
}

function devTestConsoleUpdateRequirements() {
  let pass = 0, fail = 0;
  const check = (l, c) => { if (c) { pass++; console.log('PASS ' + l); } else { fail++; console.log('FAIL ' + l); } };
  const proj = listActiveProjects_().find((p) => /dev/i.test(p.name));
  if (!proj) { console.log('FAIL no Dev Project — run devSeedDevProject first'); return; }

  // Capture the project's real requirements so the test can RESTORE them — it
  // must not clobber whatever the teacher configured on the Dev Project. The
  // normalized parse (nulls for unset) round-trips through validateRequirementsInput_,
  // which treats null as "unset", so the restore is faithful.
  const original = parseProjectRequirements_(getProject_(proj.projectId));
  try {
    consoleUpdateProjectRequirements(proj.projectId, { minSources: 4, minHighlightsPerSource: 2, minDistinctCategories: 3, requireAnnotation: false });
    const after = parseProjectRequirements_(getProject_(proj.projectId));
    check('minSources persisted 4',        after.minSources === 4);
    check('minHighlights persisted 2',     after.minHighlightsPerSource === 2);
    check('minDistinct persisted 3',       after.minDistinctCategories === 3);
    check('requireAnnotation persisted false', after.requireAnnotation === false);

    consoleUpdateProjectRequirements(proj.projectId, { requireAnnotation: true });
    const reset = parseProjectRequirements_(getProject_(proj.projectId));
    check('reset → minSources null',       reset.minSources === null);
    check('reset → requireAnnotation true', reset.requireAnnotation === true);
  } finally {
    consoleUpdateProjectRequirements(proj.projectId, original);   // non-destructive
  }
  console.log(pass + '/' + (pass + fail) + ' passed');
}

/** Runs every requirements test in one shot; prints a single summary. */
function devTestRequirementsAll() {
  console.log('--- devTestProjectRequirementsParse ---');             devTestProjectRequirementsParse();
  console.log('--- devTestRequirementsValidation ---');              devTestRequirementsValidation();
  console.log('--- devTestCompletionRespectsAnnotationToggle ---');  devTestCompletionRespectsAnnotationToggle();
  console.log('--- devTestEvidenceDepth ---');                       devTestEvidenceDepth();
  console.log('--- devTestSourcesProgress ---');                     devTestSourcesProgress();
  console.log('--- devTestRequirementsBackCompat ---');              devTestRequirementsBackCompat();
  console.log('--- devTestConsoleUpdateRequirements (needs Dev Project) ---'); devTestConsoleUpdateRequirements();
}

/**
 * Locks consoleCreateBundle: staff-gated wrapper over createBundle_ that
 * persists a reusable bundle; off-palette colors and wrong label counts are
 * rejected by the underlying validator.
 */
function devTestConsoleCreateBundle() {
  const checks = [];
  const created = [];
  const check = (label, ok) => { checks.push({ label, ok }); };
  const name = 'devtest set ' + uuid_().slice(0, 8);
  try {
    const resp = consoleCreateBundle({
      name, style: 'mla',
      labels: ['Aa', 'Bb', 'Cc', 'Dd', 'Ee'],
      colors: PRESET_PALETTE.slice(0, 5),
    });
    if (resp && resp.bundle && resp.bundle.bundleId) created.push(resp.bundle.bundleId);
    check('ok true', resp && resp.ok === true);
    check('bundle has id', !!(resp.bundle && resp.bundle.bundleId));
    check('persisted + readable', !!getBundle_(resp.bundle.bundleId));
    check('label1 stored', resp.bundle.label1 === 'Aa');
    check('color5 stored', resp.bundle.color5 === PRESET_PALETTE[4]);

    let threwColor = false;
    try {
      const r = consoleCreateBundle({ name: name + '-x', labels: ['Aa','Bb','Cc','Dd','Ee'],
        colors: ['#000000', PRESET_PALETTE[1], PRESET_PALETTE[2], PRESET_PALETTE[3], PRESET_PALETTE[4]] });
      if (r && r.bundle) created.push(r.bundle.bundleId);
    } catch (e) { threwColor = true; }
    check('off-palette color rejected', threwColor);

    let threwLabels = false;
    try {
      const r = consoleCreateBundle({ name: name + '-y', labels: ['Aa','Bb','Cc'], colors: PRESET_PALETTE.slice(0, 5) });
      if (r && r.bundle) created.push(r.bundle.bundleId);
    } catch (e) { threwLabels = true; }
    check('wrong label count rejected', threwLabels);
  } finally {
    created.forEach((id) => { try { devDeleteBundleRow_(id); } catch (e) {} });
  }
  const pass = checks.every((c) => c.ok);
  console.log(JSON.stringify({ ok: pass, checks }, null, 2));
  return { ok: pass };
}

/**
 * Locks the cross-request group-membership cache (66_groups.js):
 *   - the generation token is stable across reads,
 *   - resetGroupSheetCache_ (called by every group mutation) mints a NEW
 *     token, so any cached membership map is orphaned instantly,
 *   - a membership map round-trips through CacheService under the gen key,
 *     including the {} "no groups" sentinel.
 * Run alongside devTestGroupsAll, which exercises the real
 * findGroupSheetForStudent_ routing across mutations with resets between
 * steps (its fixtures call resetGroupSheetCache_, so a stale-cache bug
 * there would show up as a routing failure).
 */
function devTestGroupMembershipCache() {
  const checks = [];
  const check = (label, ok, detail) => { checks.push({ label, ok, detail: detail || '' }); };

  const gen1 = groupCacheGen_();
  const gen1b = groupCacheGen_();
  check('gen stable across reads', gen1 === gen1b, gen1 + ' vs ' + gen1b);

  resetGroupSheetCache_(); bumpSheetRefVersion_();
  const gen2 = groupCacheGen_();
  check('reset mints a new gen', gen1 !== gen2, gen1 + ' vs ' + gen2);

  const cache = CacheService.getScriptCache();
  const key = 'grp:v1:' + gen2 + ':devtest-project';
  cache.put(key, JSON.stringify({ 'kid@x.org': 'sheet123' }), 60);
  const back = JSON.parse(cache.get(key));
  check('map round-trips', back['kid@x.org'] === 'sheet123');

  const emptyKey = 'grp:v1:' + gen2 + ':devtest-empty';
  cache.put(emptyKey, JSON.stringify({}), 60);
  const emptyBack = cache.get(emptyKey);
  check('no-groups sentinel {} is a cache HIT (not a miss)', emptyBack !== null && JSON.stringify(JSON.parse(emptyBack)) === '{}');

  resetGroupSheetCache_(); bumpSheetRefVersion_();
  check('old-gen key orphaned after reset', groupCacheGen_() !== gen2);

  cache.remove(key); cache.remove(emptyKey);
  const pass = checks.every((c) => c.ok);
  console.log(JSON.stringify({ ok: pass, checks }, null, 2));
  return { ok: pass };
}

/**
 * Pure tests for the class naming/key layer (Classes: Name + Period + composed
 * key). Locks: composeClassKeyParts_ shapes, normalizePeriodToken_ variants,
 * and parseClassNamePeriod_'s migration parsing (period peeled from a legacy
 * key; unparseable names pass through whole). No Sheets access.
 */
function devTestClassNaming() {
  const checks = [];
  const check = (label, got, want) => {
    checks.push({ label, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
  };

  check('compose full', composeClassKeyParts_('US History', 'P3', 'Ivers'), 'US History P3 — Ivers');
  check('compose no period', composeClassKeyParts_('Advisory', '', 'Ivers'), 'Advisory — Ivers');
  check('compose no teacher', composeClassKeyParts_('US History', 'P3', ''), 'US History P3');
  check('compose bare', composeClassKeyParts_('  DEV  ', '', ''), 'DEV');

  check('period P3', normalizePeriodToken_('p3'), 'P3');
  check('period "Period 3"', normalizePeriodToken_('Period 3'), 'P3');
  check('period "per. 3"', normalizePeriodToken_('per. 3'), 'P3');
  check('period Hour', normalizePeriodToken_('hour 2'), 'Hour 2');
  check('period Block', normalizePeriodToken_('block a'), 'Block A');
  check('period odd passes through', normalizePeriodToken_('AM Session'), 'AM Session');
  check('period blank', normalizePeriodToken_(''), '');

  check('parse trailing P3', parseClassNamePeriod_('US History P3'), { name: 'US History', period: 'P3' });
  check('parse "Period 3"', parseClassNamePeriod_('NHD Period 3'), { name: 'NHD', period: 'P3' });
  check('parse dash sep', parseClassNamePeriod_('Capstone - Hour 2'), { name: 'Capstone', period: 'Hour 2' });
  check('parse Block', parseClassNamePeriod_('Science Block B'), { name: 'Science', period: 'Block B' });
  check('parse no period', parseClassNamePeriod_('DEV'), { name: 'DEV', period: '' });
  check('parse period-only string stays whole', parseClassNamePeriod_('P3'), { name: 'P3', period: '' });

  const pass = checks.every((c) => c.ok);
  checks.filter((c) => !c.ok).forEach((c) =>
    Logger.log('FAIL ' + c.label + ': got ' + JSON.stringify(c.got) + ' want ' + JSON.stringify(c.want)));
  Logger.log(pass ? 'devTestClassNaming ALL GREEN (' + checks.length + ')' : 'devTestClassNaming NOT GREEN');
  return { ok: pass, checks };
}

// ============================================================
// Read-cache layer (05_cache.js) + combined endpoints
// ============================================================

/**
 * Locks the CacheService read-through layer: memo + cross-request hit, drop,
 * chunking of >90KB values, and the sheet-ref version bump that every group
 * mutation performs (withGroupLock_). Pure against CacheService — no Sheets.
 * The same cases run headless in apps-script/test/cache.node.test.js.
 */
function devTestOpsCache() {
  let pass = 0, fail = 0;
  const check = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };
  const key = 'devtest:' + Utilities.getUuid();
  let computes = 0;
  const a = cachedJson_(key, 60, () => { computes++; return { n: 1 }; });
  const b = cachedJson_(key, 60, () => { computes++; return { n: 2 }; });
  check('memo hit within execution', a.n === 1 && b.n === 1 && computes === 1);
  delete _opsExecMemo[OPS_CACHE_NS + key];   // simulate a new execution
  const c = cachedJson_(key, 60, () => { computes++; return { n: 3 }; });
  check('CacheService hit across executions', c.n === 1 && computes === 1);
  cacheDrop_(key);
  const d = cachedJson_(key, 60, () => { computes++; return { n: 4 }; });
  check('drop forces recompute', d.n === 4 && computes === 2);

  const bigKey = 'devtest:big:' + Utilities.getUuid();
  const big = []; for (let i = 0; i < 3000; i++) big.push({ i, t: 'x'.repeat(60) });   // ~230KB
  cachedJson_(bigKey, 60, () => big);
  delete _opsExecMemo[OPS_CACHE_NS + bigKey];
  const back = cachedJson_(bigKey, 60, () => []);
  check('>100KB value chunked + reassembled', Array.isArray(back) && back.length === 3000 && back[2999].i === 2999);
  cacheDrop_(bigKey);

  putCachedSheetRef_('devproj', 'Someone@Example.org', { id: 'abc', kind: 'solo' });
  check('sheet ref case-insensitive hit', (getCachedSheetRef_('devproj', 'someone@example.org') || {}).id === 'abc');
  bumpSheetRefVersion_();
  check('bump invalidates sheet ref', getCachedSheetRef_('devproj', 'someone@example.org') === null);

  console.log(fail === 0 ? 'devTestOpsCache: ALL GREEN' : 'devTestOpsCache: NOT GREEN (' + fail + ' fail)');
  return { pass, fail };
}

/**
 * The combined GET actions the extension now uses: `bootstrap` (me + projects
 * + bundles + activeProjectId in one call) and `myProjectData` (sources +
 * highlights in one Sheet open). Asserts shape parity with the individual
 * actions so the extension's legacy fallback stays interchangeable. Needs the
 * Dev Project (devSeedDevProject) for the data half.
 */
function devTestCombinedEndpoints() {
  let pass = 0, fail = 0;
  const check = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

  const boot = handleGet_({ parameter: { action: 'bootstrap' } });
  const me = handleGet_({ parameter: { action: 'me' } });
  const projects = handleGet_({ parameter: { action: 'projects' } });
  const bundles = handleGet_({ parameter: { action: 'bundles' } });
  check('bootstrap ok', boot && boot.ok === true);
  check('bootstrap.me == me', JSON.stringify(boot.me) === JSON.stringify(me));
  check('bootstrap.projects == projects', JSON.stringify(boot.projects) === JSON.stringify(projects.projects));
  check('bootstrap.bundles == bundles', JSON.stringify(boot.bundles) === JSON.stringify(bundles.bundles));
  check('bootstrap carries activeProjectId key', 'activeProjectId' in boot);

  const dev = listProjects_().find((p) => p.name === 'Dev Project');
  if (!dev) {
    console.log('SKIP myProjectData parity — run devSeedDevProject first');
  } else {
    const combined = handleGet_({ parameter: { action: 'myProjectData', projectId: dev.projectId } });
    const s = handleGet_({ parameter: { action: 'mySources', projectId: dev.projectId } });
    const h = handleGet_({ parameter: { action: 'myHighlights', projectId: dev.projectId } });
    check('myProjectData ok', combined && combined.ok === true);
    check('myProjectData.sources == mySources', JSON.stringify(combined.sources) === JSON.stringify(s.sources));
    check('myProjectData.highlights == myHighlights', JSON.stringify(combined.highlights) === JSON.stringify(h.highlights));
    const unknown = handleGet_({ parameter: { action: 'myProjectData' } });
    check('myProjectData without projectId → not ok', unknown && unknown.ok === false);
  }

  const cb = consoleBootstrap('active');
  const ctx = consoleGetContext();
  check('consoleBootstrap ctx == consoleGetContext', JSON.stringify(cb.ctx) === JSON.stringify(ctx));
  if (ctx && ctx.staff) {
    const mine = consoleGetMyProjects('active');
    check('consoleBootstrap projects == consoleGetMyProjects', JSON.stringify(cb.projects) === JSON.stringify(mine.projects));
  }

  console.log(fail === 0 ? 'devTestCombinedEndpoints: ALL GREEN' : 'devTestCombinedEndpoints: NOT GREEN (' + fail + ' fail)');
  return { pass, fail };
}

/**
 * Locks that the cached (student, project) → Sheet resolution returns the
 * SAME Sheet as the uncached walk, and that a version bump forces the walk
 * again. Uses the Dev Project + the script owner's dev roster row.
 */
function devTestSheetResolutionCache() {
  let pass = 0, fail = 0;
  const check = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };
  const dev = listProjects_().find((p) => p.name === 'Dev Project');
  if (!dev) { console.log('SKIP — run devSeedDevProject first'); return { pass, fail, skipped: true }; }
  const me = getActorEmail_();
  bumpSheetRefVersion_();
  check('cold: no cached ref', getCachedSheetRef_(dev.projectId, me) === null);
  const first = findOrCreateStudentSheet_(me, dev);
  const ref = getCachedSheetRef_(dev.projectId, me);
  check('resolution recorded in cache', !!ref && ref.id === first.getId());
  const second = getStudentSheetIfExists_(me, dev);
  check('read path returns the same Sheet', second && second.getId() === first.getId());
  bumpSheetRefVersion_();
  check('bump clears the ref', getCachedSheetRef_(dev.projectId, me) === null);
  const third = getStudentSheetIfExists_(me, dev);
  check('re-walk after bump lands on the same Sheet', third && third.getId() === first.getId());
  console.log(fail === 0 ? 'devTestSheetResolutionCache: ALL GREEN' : 'devTestSheetResolutionCache: NOT GREEN (' + fail + ' fail)');
  return { pass, fail };
}

/** Runs the three cache/endpoint tests above in one shot. */
function devTestPerfLayerAll() {
  const r = [devTestOpsCache(), devTestCombinedEndpoints(), devTestSheetResolutionCache()];
  const fail = r.reduce((n, x) => n + (x.fail || 0), 0);
  console.log(fail === 0 ? 'devTestPerfLayerAll: ALL GREEN' : 'devTestPerfLayerAll: NOT GREEN (' + fail + ' fail)');
}
