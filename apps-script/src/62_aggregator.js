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
 * Parse + normalize a project's `requirements` JSON. Every key is present in
 * the output: null = "no requirement". `requireAnnotation` defaults TRUE —
 * existing projects (empty cell) must keep requiring annotation, today's behavior.
 * Pure. Single definition (grep before adding a same-named helper — §5 shadow trap).
 */
function parseProjectRequirements_(project) {
  const raw = project ? parseJsonColumn_(project.requirements) : {};
  const posInt = (v) => {
    const n = Math.floor(Number(v));
    return (isFinite(n) && n >= 1) ? n : null;
  };
  const cats = posInt(raw.minDistinctCategories);
  return {
    minSources:             posInt(raw.minSources),
    minHighlightsPerSource: posInt(raw.minHighlightsPerSource),
    minDistinctCategories:  cats === null ? null : Math.min(cats, 5),
    requireAnnotation:      raw.requireAnnotation === false ? false : true,
  };
}

/**
 * One dashboard-row's worth of aggregates for a single student.
 *
 *   aggregateStudent_(sources, highlights, bundle [, requirements])
 *     → { categoryMix, sourceCount, highlightCount, completion, gaps,
 *          sourcesProgress, evidenceDepth, lastActivity }
 *
 * `categoryMix` preserves bundle order so the dashboard stack-bar always
 * paints categories in the same slot regardless of insertion order.
 */
function aggregateStudent_(sources, highlights, bundle, requirements) {
  const req = requirements || parseProjectRequirements_({});
  const depth = computeEvidenceDepth_(sources, highlights, req);
  return {
    categoryMix: formatBundleCategoryMix_(highlights, bundle),
    sourceCount: sources.length,
    highlightCount: highlights.length,
    completion: computeCompletionSummary_(sources, req),
    gaps: computeGaps_(sources),
    sourcesProgress: computeSourcesProgress_(sources, req),
    // Row payload: rollup only (omit perSource to keep the dashboard response small).
    evidenceDepth: {
      targetSet: depth.targetSet,
      total: depth.total,
      sourcesMeeting: depth.sourcesMeeting,
      minHighlightsPerSource: depth.minHighlightsPerSource,
      minDistinctCategories: depth.minDistinctCategories,
    },
    lastActivity: computeLastActivity_(sources, highlights),
  };
}

/**
 * Drill-down aggregates — richer than dashboard, includes activity-by-day.
 */
function aggregateStudentDetail_(sources, highlights, bundle, projectCreatedAt, requirements) {
  const req = requirements || parseProjectRequirements_({});
  return {
    categoryMix: formatBundleCategoryMix_(highlights, bundle),
    sourceCounts: computeSourceCounts_(sources),
    completion: computeCompletion_(sources),
    sourcesProgress: computeSourcesProgress_(sources, req),
    // Drill-down: full per-source list so the viewer can annotate each source.
    evidenceDepth: computeEvidenceDepth_(sources, highlights, req),
    requireAnnotation: req.requireAnnotation,
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
 *   citation:       isCitationComplete_ (title + url entered, or a pasted citation)
 *   classification: primarySecondary !== 'unset'
 *   annotation:     trimmed annotation length > 0
 *
 * Returns { citation: {complete, total}, classification: {...}, annotation: {...} }
 */
function computeCompletion_(sources) {
  let citation = 0, classification = 0, annotation = 0;
  sources.forEach((s) => {
    if (isCitationComplete_(parseCitationFields_(s))) citation++;
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
 *   percent = sources where ALL of (citation, classification, AND — only when
 *   the project requires it — annotation) / total. Zero sources → 0%.
 * `requirements` is the normalized object from parseProjectRequirements_ (or
 * undefined for the legacy no-requirements behavior, which requires annotation).
 */
function computeCompletionSummary_(sources, requirements) {
  if (sources.length === 0) return { percent: 0, complete: 0, total: 0 };
  const needAnn = !requirements || requirements.requireAnnotation !== false;
  let complete = 0;
  sources.forEach((s) => {
    const citationOk = isCitationComplete_(parseCitationFields_(s));
    const classOk = s.primarySecondary && s.primarySecondary !== 'unset';
    const annOk = !needAnn || (s.annotation && String(s.annotation).trim().length > 0);
    if (citationOk && classOk && annOk) complete++;
  });
  return {
    percent: Math.round((complete / sources.length) * 100),
    complete,
    total: sources.length,
  };
}

/**
 * Per-source "evidence depth" against the optional per-source targets. Only
 * meaningful when minHighlightsPerSource and/or minDistinctCategories is set
 * (targetSet). distinctCategoryCount counts distinct non-empty primaryCategory
 * — secondary tags never count (dashboard counts primary only). An unset
 * sub-target is vacuously met. Pure.
 */
function computeEvidenceDepth_(sources, highlights, requirements) {
  const req = requirements || {};
  const minH = req.minHighlightsPerSource || null;
  const minC = req.minDistinctCategories || null;
  const bySource = {};
  highlights.forEach((h) => {
    const sid = h.sourceId;
    if (!bySource[sid]) bySource[sid] = { count: 0, cats: {} };
    bySource[sid].count++;
    if (h.primaryCategory) bySource[sid].cats[h.primaryCategory] = true;
  });
  const perSource = sources.map((s) => {
    const g = bySource[s.sourceId] || { count: 0, cats: {} };
    const distinct = Object.keys(g.cats).length;
    const meetsHighlights = minH ? g.count >= minH : true;
    const meetsCategories = minC ? distinct >= minC : true;
    return {
      sourceId: s.sourceId,
      highlightCount: g.count,
      distinctCategoryCount: distinct,
      meetsHighlights,
      meetsCategories,
      meets: meetsHighlights && meetsCategories,
    };
  });
  return {
    targetSet: !!(minH || minC),
    minHighlightsPerSource: minH,
    minDistinctCategories: minC,
    total: sources.length,
    sourcesMeeting: perSource.filter((p) => p.meets).length,
    perSource,
  };
}

/** Project-level source-count progress against optional minSources. Pure. */
function computeSourcesProgress_(sources, requirements) {
  const min = (requirements && requirements.minSources) || null;
  return {
    minSources: min,
    sourceCount: sources.length,
    meets: min ? sources.length >= min : true,
  };
}

/** Per-field gap counts (number of sources missing each field). */
function computeGaps_(sources) {
  let cit = 0, cls = 0, ann = 0;
  sources.forEach((s) => {
    if (!isCitationComplete_(parseCitationFields_(s))) cit++;
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
 * "Citation done" for the dashboard: the student entered title AND url, or
 * pasted a whole citation (copied from the database/encyclopedia). Takes the
 * RAW parse — scraped values never count. Pure.
 */
function isCitationComplete_(parsed) {
  if (!parsed) return false;
  if (parsed.title && parsed.url) return true;
  const p = parsed.pasted;
  return !!(p && typeof p === 'object' && String(p.text || '').trim());
}

/**
 * Parse ONLY the `citationFields` JSON column to an object — no scraped*
 * fallback. Safe on null, malformed JSON, and non-string types. This is the
 * RAW parser the completion metrics need: "citation complete" must mean the
 * student explicitly entered citation fields, not that a scrape auto-filled
 * them (otherwise every source counts as cited the moment it's created).
 *
 * For RENDERING a citation (bibliography, inline), use buildCitationFields_ in
 * 52_bibliography.js, which adds the scraped fallback. The two MUST keep
 * distinct names: they share GAS's single global namespace, and an earlier
 * same-named copy here shadowed 52's richer version (62 loads after 52),
 * silently dropping the fallback and blanking scraped-only sources in the bib.
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
