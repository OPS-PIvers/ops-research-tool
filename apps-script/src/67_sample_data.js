/**
 * Sample / demo data for the Teacher Console.
 *
 * A header toggle (admin-only) seeds — once, lazily — and shows/hides a spread
 * of ~18 fake students in the Dev Project's DEV class, each in a deliberately
 * different state (not-started, highlights-only, classified-only, cited-only,
 * annotated-only, partial, exemplary, category-skewed, source-type varied,
 * sparse vs deep) so a teacher sees the full range of dashboard rows AND
 * drill-downs. Real students added to the class still show alongside.
 *
 * Toggling only flips a flag (instant); the seeded rows persist and are hidden
 * when off (every console roster read passes through excludeSampleIfDisabled_).
 * Hard teardown — trash the Sheets + drop the roster rows — is devClearSampleData().
 *
 * Sample students are marked by a fake email domain (SAMPLE_DOMAIN). They never
 * authenticate; the address is only a roster key + per-student Sheet name.
 */

const SAMPLE_DOMAIN = 'sample.oronoresearch';   // marker only — never a real login
const SAMPLE_FLAG_KEY = 'OPS_SAMPLE_ENABLED';
const SAMPLE_CLASS = 'DEV';
const SAMPLE_PROJECT_NAME = 'Dev Project';

/** True for a seeded sample student's email. */
function isSampleEmail_(email) {
  return String(email || '').toLowerCase().indexOf('@' + SAMPLE_DOMAIN) >= 0;
}

/** Is the sample-data toggle on? */
function consoleSampleDataEnabled_() {
  return PropertiesService.getScriptProperties().getProperty(SAMPLE_FLAG_KEY) === '1';
}

/**
 * Drop sample roster rows from any console read when the toggle is off. The
 * single chokepoint so the dashboard, project-card counts, and admin roster all
 * stay consistent. Rows use the roster's capitalized `Email` field.
 */
function excludeSampleIfDisabled_(rosterRows) {
  if (consoleSampleDataEnabled_()) return rosterRows || [];
  return (rosterRows || []).filter((r) => !isSampleEmail_(r.Email));
}

/**
 * Toggle handler (admin-only). Enabling seeds the sample students if they're
 * not present yet (idempotent), then flips the flag. The dashboard cache keys
 * on the flag, so the next load recomputes for the new state.
 */
function consoleSetSampleData(enabled) {
  assertAdmin_(getActorEmail_());
  const on = !!enabled;
  if (on) seedSampleData_();
  PropertiesService.getScriptProperties().setProperty(SAMPLE_FLAG_KEY, on ? '1' : '0');
  return { ok: true, enabled: on, count: SAMPLE_STUDENTS.length };
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/** Shorthand for a source spec: type, primary/secondary|null, cited, annotated, [categoryIdx…]. */
function S_(t, ps, c, a, h) { return { t: t, ps: ps, c: c, a: a, h: h }; }

// 18 students, each a distinct dashboard/drill-down shape. Category indices map
// to the bundle's label1..label5 (History Day: Background, Build-Up, Main Event,
// Short-Term Impact, Long-Term Impact). A "complete" source is cited+classified+
// annotated (c:true, ps set, a:true).
const SAMPLE_STUDENTS = [
  { first: 'Ava',      last: 'Nguyen',   sources: [] },                                    // not started
  { first: 'Liam',     last: 'Okafor',   sources: [S_('website', null, false, false, [0])] }, // just started
  { first: 'Sofia',    last: 'Reyes',    sources: [                                         // highlights, no curation
      S_('website', null, false, false, [0, 1, 1]), S_('article', null, false, false, [2, 2]),
      S_('website', null, false, false, [3, 4])] },
  { first: 'Noah',     last: 'Patel',    sources: [                                         // classified only
      S_('website', 'primary', false, false, [1]), S_('article', 'secondary', false, false, [2]),
      S_('book', 'secondary', false, false, [0]), S_('website', 'primary', false, false, [3])] },
  { first: 'Mia',      last: 'Johnson',  sources: [                                         // cited only
      S_('article', null, true, false, [2]), S_('website', null, true, false, [1]),
      S_('website', null, true, false, [4])] },
  { first: 'Ethan',    last: 'Kim',      sources: [                                         // annotated only
      S_('website', null, false, true, [0]), S_('article', null, false, true, [2]),
      S_('website', null, false, true, [3])] },
  { first: 'Olivia',   last: 'Martinez', sources: [                                         // half complete
      S_('website', 'primary', true, true, [0]), S_('article', 'secondary', true, true, [2]),
      S_('website', 'primary', true, true, [1]), S_('website', 'primary', true, false, [3]),
      S_('article', 'secondary', true, false, [2]), S_('book', 'secondary', true, false, [4])] },
  { first: 'Lucas',    last: 'Brown',    sources: [                                         // almost done (1 unclassified)
      S_('website', 'primary', true, true, [0]), S_('article', 'secondary', true, true, [2]),
      S_('book', 'primary', true, true, [1]), S_('primary', 'primary', true, true, [2, 3]),
      S_('website', null, true, true, [4])] },
  { first: 'Emma',     last: 'Wilson',   sources: [                                         // exemplary — 100%
      S_('website', 'primary', true, true, [0, 0]), S_('article', 'secondary', true, true, [1]),
      S_('book', 'primary', true, true, [2]), S_('primary', 'primary', true, true, [2]),
      S_('website', 'secondary', true, true, [3]), S_('article', 'primary', true, true, [3, 4]),
      S_('book', 'secondary', true, true, [4]), S_('website', 'secondary', true, true, [1, 2])] },
  { first: 'Mason',    last: 'Lee',      sources: [                                         // background-heavy
      S_('website', 'primary', true, true, [0, 0, 0]), S_('website', 'primary', true, false, [0]),
      S_('article', 'secondary', false, false, [0, 1])] },
  { first: 'Isabella', last: 'Garcia',   sources: [                                         // main-event focus
      S_('article', 'primary', true, true, [2, 2]), S_('website', 'secondary', true, true, [2]),
      S_('website', 'primary', true, false, [2]), S_('book', 'secondary', false, false, [2, 3])] },
  { first: 'Jacob',    last: 'Smith',    sources: [                                         // balanced ~70%
      S_('website', 'primary', true, true, [0]), S_('article', 'secondary', true, true, [1]),
      S_('book', 'primary', true, true, [2]), S_('website', 'secondary', true, false, [3]),
      S_('article', 'primary', false, true, [4])] },
  { first: 'Amara',    last: 'Clark',    sources: [                                         // sparse 50%
      S_('website', 'primary', true, true, [1]), S_('article', null, false, false, [3])] },
  { first: 'Henry',    last: 'Davis',    sources: [                                         // source hoarder, low completion
      S_('website', 'primary', true, true, [0]), S_('website', null, false, false, [1]),
      S_('article', null, false, false, [2]), S_('book', null, false, false, []),
      S_('website', null, false, false, []), S_('website', null, false, false, [3]),
      S_('article', null, false, false, []), S_('website', null, false, false, [4]),
      S_('book', null, false, false, []), S_('article', 'secondary', true, true, [2])] },
  { first: 'Zoe',      last: 'Thompson', sources: [                                         // deep reader — few sources, many highlights
      S_('article', 'primary', true, true, [0, 1, 2, 2, 3]),
      S_('book', 'secondary', true, true, [1, 2, 3, 4, 4, 2, 0])] },
  { first: 'Daniel',   last: 'Park',     sources: [                                         // book/primary types, complete
      S_('book', 'primary', true, true, [0]), S_('book', 'secondary', true, true, [2]),
      S_('primary', 'primary', true, true, [2, 3])] },
  { first: 'Layla',    last: 'Hassan',   sources: [                                         // primary-source heavy ~80%
      S_('primary', 'primary', true, true, [2]), S_('primary', 'primary', true, true, [1]),
      S_('primary', 'primary', true, false, [3]), S_('article', 'secondary', true, true, [0])] },
  { first: 'Owen',     last: 'Murphy',   sources: [                                         // mixed bag ~85%
      S_('website', 'primary', true, true, [0]), S_('article', 'secondary', true, true, [2]),
      S_('book', 'primary', true, true, [1]), S_('primary', 'secondary', true, true, [3]),
      S_('website', 'primary', true, false, [4]), S_('article', 'secondary', true, true, [2, 3])] },
];

const SAMPLE_TITLES = [
  'The Road to Conflict', 'Causes and Consequences', 'A Nation Divided', 'Voices from the Era',
  'Turning Points in History', 'Aftermath and Legacy', 'A Firsthand Account', 'A Scholarly Analysis',
  'An Overview of the Period', 'Key Figures and Decisions', 'Economic Pressures Explained',
  'The Decisive Moment', 'Reactions and Reform', 'Mapping the Movement',
];
const SAMPLE_SITES = ['History.org', 'National Archives', 'JSTOR', 'Library of Congress', 'Britannica', 'Smithsonian Magazine'];
const SAMPLE_AUTHORS = ['Reed, Marcus', 'Allende, Paula', 'Tanaka, Yuki', 'Okeke, Ngozi', 'Hartman, Lou'];
const SAMPLE_DATES = ['2019-04-16', '20210830', 'March 3, 2020', '2018', '2022-11-01', 'July 12, 2021'];
const SAMPLE_ANNOTATIONS = [
  'Provides background on the topic and is useful for understanding the underlying causes.',
  'A scholarly analysis that backs my main argument with primary evidence.',
  'A firsthand account that adds perspective to the central event.',
  'Useful for the long-term impact section; corroborates two of my other sources.',
  'Offers a counterpoint I plan to address in my analysis.',
];
const SAMPLE_HL_TEXT = [
  'Historians broadly agree the underlying tensions had been building for years before the break.',
  'The decisive moment came when negotiations finally collapsed in the spring.',
  'Contemporary accounts describe widespread upheaval in the months that followed.',
  'The long-term consequences reshaped the region for a generation.',
  'Economic pressures played a central role in the escalation of the conflict.',
  'Eyewitnesses recorded scenes that contradicted the official version of events.',
];

function sampleEmail_(profile) {
  return (profile.first + '.' + profile.last + '@' + SAMPLE_DOMAIN).toLowerCase();
}

/** Find the Dev Project; create it (idempotent) if it doesn't exist yet. */
function ensureDevProjectForSamples_() {
  const existing = listProjects_().find((p) => p.name === SAMPLE_PROJECT_NAME);
  return existing || devSeedDevProject();
}

/**
 * Create roster rows + populate per-student Sheets for every sample student.
 * Idempotent: roster rows are added only if absent, and source/highlight IDs
 * are deterministic so a re-run overwrites the same rows instead of duplicating.
 */
function seedSampleData_() {
  const project = ensureDevProjectForSamples_();
  const bundle = getBundle_(project.bundleId);
  const labels = [];
  for (let i = 1; i <= 5; i++) if (bundle['label' + i]) labels.push(bundle['label' + i]);
  const teacherEmail = getActorEmail_();

  ensureClassSchema_();
  // Ensure the sample class exists, owned by the demoing teacher so it shows
  // under their classes on the dashboard.
  if (!getClassRecord_(SAMPLE_CLASS)) createClass_(SAMPLE_CLASS, teacherEmail, '');

  // Already seeded? (first sample student present) → no-op, so disabling then
  // re-enabling is instant instead of re-provisioning every Sheet.
  if (getStudentIdentity_(sampleEmail_(SAMPLE_STUDENTS[0]))) return;

  SAMPLE_STUDENTS.forEach((p, idx) => {
    const email = sampleEmail_(p);
    upsertStudent_({ ID: '', First: p.first, Last: p.last, Email: email });
    enroll_(email, SAMPLE_CLASS);
    if (!p.sources.length) return;        // "not started" — no Sheet, shows as 0%
    SpreadsheetApp.flush();               // enrollment visible before provisioning reads it
    const ss = findOrCreateSoloSheet_(email, project);
    buildSampleStudentData_(ss, project.projectId, email, idx, p, labels);
  });
}

/** Write one sample student's Sources + Highlights from their profile spec. */
function buildSampleStudentData_(ss, projectId, email, idx, profile, labels) {
  profile.sources.forEach((spec, si) => {
    const title = SAMPLE_TITLES[(idx + si) % SAMPLE_TITLES.length];
    const site = SAMPLE_SITES[(idx + si) % SAMPLE_SITES.length];
    const author = SAMPLE_AUTHORS[(idx + si) % SAMPLE_AUTHORS.length];
    const date = SAMPLE_DATES[(idx + si) % SAMPLE_DATES.length];
    const rawUrl = 'https://example.org/sample/' + idx + '/' + si + '/' + encodeURIComponent(title.toLowerCase().replace(/\s+/g, '-'));
    const sourceId = 'samp-' + idx + '-s' + si;

    const source = {
      sourceId: sourceId,
      projectId: projectId,
      rawUrl: rawUrl,
      accessDate: sampleIso_(idx, si),
      scrapedTitle: title,
      scrapedSite: site,
      scrapedAuthor: author,
      scrapedDate: date,
      sourceType: spec.t,
      createdByEmail: email,
      createdAt: sampleIso_(idx, si),
    };
    if (spec.ps) source.primarySecondary = spec.ps;      // else upsert defaults to 'unset'
    if (spec.a) source.annotation = SAMPLE_ANNOTATIONS[(idx + si) % SAMPLE_ANNOTATIONS.length];
    if (spec.c) {
      // citationFields needs title + url for the completion metric to count it.
      source.citationFields = {
        sourceType: spec.t, title: title, url: rawUrl, siteName: site,
        author: author, publishedDate: date,
      };
    }
    upsertSource_(ss, source);

    (spec.h || []).forEach((catIdx, j) => {
      upsertHighlight_(ss, {
        highlightId: sourceId + '-h' + j,
        sourceId: sourceId,
        projectId: projectId,
        primaryCategory: labels[catIdx] || labels[0],
        highlightedText: SAMPLE_HL_TEXT[(idx + si + j) % SAMPLE_HL_TEXT.length],
        note: (j % 3 === 0) ? 'Worth quoting in the draft.' : '',
        createdByEmail: email,
        createdAt: sampleIso_(idx, si + j),
      });
    });
  });
}

/** Deterministic-ish recent timestamp so lastActivity / activity-by-day vary per row. */
function sampleIso_(idx, k) {
  const hoursAgo = (idx * 7 + k * 3) % (24 * 21);   // spread across ~3 weeks
  return new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Teardown (hard delete — the toggle only hides; this removes)
// ---------------------------------------------------------------------------

/** Editor-callable hard reset: trash sample Sheets + drop sample roster rows. */
function devClearSampleData() { return clearSampleData_(); }

/** Admin-callable hard reset (e.g. wire to a future "remove sample data" button). */
function consoleClearSampleData() {
  assertAdmin_(getActorEmail_());
  return clearSampleData_();
}

function clearSampleData_() {
  const project = listProjects_().find((p) => p.name === SAMPLE_PROJECT_NAME);
  ensureClassSchema_();
  let trashed = 0, removed = 0;
  SAMPLE_STUDENTS.forEach((p) => {
    const email = sampleEmail_(p);
    if (project) {
      const ss = getSoloSheetIfExists_(email, project);
      if (ss) {
        DriveApp.getFileById(ss.getId()).setTrashed(true);
        forgetSoloSheetId_(project.projectId, email);
        trashed++;
      }
    }
    if (getStudentIdentity_(email)) { deleteStudent_(email); removed++; }
  });
  bumpSheetRefVersion_();   // trashed Sheets must not be served from the resolution cache
  PropertiesService.getScriptProperties().setProperty(SAMPLE_FLAG_KEY, '0');
  return { ok: true, trashedSheets: trashed, removedRosterRows: removed };
}
