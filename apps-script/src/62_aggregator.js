/**
 * Pure aggregation functions for the Teacher Console.
 *
 * Inputs: raw rows from per-student Sheets (sources, highlights) plus the
 * project's bundle. Outputs: the shapes the Console renders.
 *
 * No Sheet access in this file — separation makes everything trivially
 * unit-testable via editor-callable devTest* functions in 99_dev.js.
 */

/**
 * One dashboard-row's worth of aggregates for a single student.
 *
 *   aggregateStudent_(sources, highlights, bundle)
 *     → { categoryMix, sourceCount, highlightCount, completion, gaps, lastActivity }
 *
 * `categoryMix` preserves bundle order so the dashboard stack-bar always
 * paints categories in the same slot regardless of insertion order.
 */
function aggregateStudent_(sources, highlights, bundle) {
  return {
    categoryMix: formatBundleCategoryMix_(highlights, bundle),
    sourceCount: sources.length,
    highlightCount: highlights.length,
    completion: computeCompletionSummary_(sources),
    gaps: computeGaps_(sources),
    lastActivity: computeLastActivity_(sources, highlights),
  };
}

/**
 * Drill-down aggregates — richer than dashboard, includes activity-by-day.
 */
function aggregateStudentDetail_(sources, highlights, bundle, projectCreatedAt) {
  return {
    categoryMix: formatBundleCategoryMix_(highlights, bundle),
    sourceCounts: computeSourceCounts_(sources),
    completion: computeCompletion_(sources),
    activityByDay: computeActivityByDay_(sources, highlights, projectCreatedAt),
  };
}

/**
 * Ordered [{label, count, color}] matching bundle.label1..label5 /
 * color1..color5. Categories with zero highlights still appear with count=0
 * so the stack-bar segment renders gray-hatched instead of being missing.
 */
function formatBundleCategoryMix_(highlights, bundle) {
  const counts = {};
  highlights.forEach((h) => {
    if (h.primaryCategory) counts[h.primaryCategory] = (counts[h.primaryCategory] || 0) + 1;
  });
  const out = [];
  if (!bundle) return out;
  for (let i = 1; i <= 5; i++) {
    const label = bundle['label' + i];
    if (!label) continue;
    out.push({ label, color: bundle['color' + i] || '#dadce0', count: counts[label] || 0 });
  }
  return out;
}

/** {primary, secondary, unset} counts. */
function computeSourceCounts_(sources) {
  const out = { primary: 0, secondary: 0, unset: 0 };
  sources.forEach((s) => {
    const ps = s.primarySecondary || 'unset';
    if (out[ps] !== undefined) out[ps]++;
    else out.unset++;
  });
  return out;
}

/**
 * Per-field completion:
 *   citation:       title AND url non-empty in citationFields (parsed JSON)
 *   classification: primarySecondary !== 'unset'
 *   annotation:     trimmed annotation length > 0
 *
 * Returns { citation: {complete, total}, classification: {...}, annotation: {...} }
 */
function computeCompletion_(sources) {
  let citation = 0, classification = 0, annotation = 0;
  sources.forEach((s) => {
    const parsed = parseCitationFields_(s);
    if (parsed.title && parsed.url) citation++;
    if (s.primarySecondary && s.primarySecondary !== 'unset') classification++;
    if (s.annotation && String(s.annotation).trim().length > 0) annotation++;
  });
  const total = sources.length;
  return {
    citation:       { complete: citation,       total },
    classification: { complete: classification, total },
    annotation:     { complete: annotation,     total },
  };
}

/**
 * Headline completion for the dashboard row:
 *   percent = sources where ALL of (citation complete, classification set,
 *             annotation non-empty) / total. Zero sources → 0%.
 */
function computeCompletionSummary_(sources) {
  if (sources.length === 0) return { percent: 0, complete: 0, total: 0 };
  let complete = 0;
  sources.forEach((s) => {
    const parsed = parseCitationFields_(s);
    const citationOk = parsed.title && parsed.url;
    const classOk = s.primarySecondary && s.primarySecondary !== 'unset';
    const annOk = s.annotation && String(s.annotation).trim().length > 0;
    if (citationOk && classOk && annOk) complete++;
  });
  return {
    percent: Math.round((complete / sources.length) * 100),
    complete,
    total: sources.length,
  };
}

/** Per-field gap counts (number of sources missing each field). */
function computeGaps_(sources) {
  let cit = 0, cls = 0, ann = 0;
  sources.forEach((s) => {
    const parsed = parseCitationFields_(s);
    if (!(parsed.title && parsed.url)) cit++;
    if (!s.primarySecondary || s.primarySecondary === 'unset') cls++;
    if (!s.annotation || String(s.annotation).trim().length === 0) ann++;
  });
  return { citation: cit, classification: cls, annotation: ann };
}

/** Latest ISO timestamp from sources + highlights. Null if both empty. */
function computeLastActivity_(sources, highlights) {
  let latest = null;
  const consider = (iso) => {
    if (!iso) return;
    if (latest === null || iso > latest) latest = iso;
  };
  sources.forEach((s) => consider(s.createdAt));
  highlights.forEach((h) => consider(h.createdAt));
  return latest;
}

/**
 * Daily-binned counts of sources + highlights from projectCreatedAt (or the
 * earliest activity, whichever is earlier) up to today.
 * Returns [{ date: 'YYYY-MM-DD', sources: N, highlights: N }, ...] in
 * chronological order. Empty days are included with zeros so the line
 * chart has no gaps.
 */
function computeActivityByDay_(sources, highlights, projectCreatedAt) {
  const dayKey = (iso) => String(iso).slice(0, 10);
  const counts = {}; // 'YYYY-MM-DD' → {sources, highlights}
  const bump = (iso, key) => {
    if (!iso) return;
    const d = dayKey(iso);
    if (!counts[d]) counts[d] = { sources: 0, highlights: 0 };
    counts[d][key]++;
  };
  sources.forEach((s) => bump(s.createdAt, 'sources'));
  highlights.forEach((h) => bump(h.createdAt, 'highlights'));

  // Range: earliest of (projectCreatedAt, observed data) to today.
  const observedKeys = Object.keys(counts);
  let startKey = projectCreatedAt ? dayKey(projectCreatedAt) : null;
  observedKeys.forEach((k) => {
    if (startKey === null || k < startKey) startKey = k;
  });
  if (!startKey) return [];
  const todayKey = dayKey(new Date().toISOString());

  const out = [];
  let cursor = new Date(startKey + 'T00:00:00Z');
  const stop = new Date(todayKey + 'T00:00:00Z');
  while (cursor.getTime() <= stop.getTime()) {
    const k = cursor.toISOString().slice(0, 10);
    const c = counts[k] || { sources: 0, highlights: 0 };
    out.push({ date: k, sources: c.sources, highlights: c.highlights });
    cursor = new Date(cursor.getTime() + 24 * 3600 * 1000);
  }
  return out;
}

/**
 * Parse `citationFields` (a JSON string column) to an object. Safe on null,
 * malformed JSON, and non-string types. Mirrors the parser in 52_bibliography.js
 * but kept local so 62 has no dependencies on other modules.
 */
function parseCitationFields_(source) {
  if (!source.citationFields) return {};
  try {
    const parsed = JSON.parse(source.citationFields);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}
