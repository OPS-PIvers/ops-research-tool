/** Category bundles. Immutable rows — once created, never edited. */

function listBundles_() {
  const ss = SpreadsheetApp.openById(CONFIG.BUNDLES_SHEET_ID);
  return readAllAsObjects_(getTab_(ss, TABS.BUNDLES), HEADERS.BUNDLES);
}

function getBundle_(bundleId) {
  return listBundles_().find((b) => b.bundleId === bundleId) || null;
}

/**
 * Create a new bundle. Validates: exactly 5 labels, exactly 5 colors from a
 * preset palette, non-empty name, valid citation style.
 */
function createBundle_({ name, style, labels, colors, createdBy }) {
  if (!name) throw new Error('Bundle name required');
  if (CITATION_STYLES.indexOf(style) < 0) throw new Error(`style must be one of ${CITATION_STYLES.join(', ')}`);
  if (!Array.isArray(labels) || labels.length !== 5) throw new Error('Exactly 5 labels required');
  if (!Array.isArray(colors) || colors.length !== 5) throw new Error('Exactly 5 colors required');
  if (labels.some((l) => !l || typeof l !== 'string')) throw new Error('All labels must be non-empty strings');
  const paletteSet = new Set(PRESET_PALETTE);
  if (colors.some((c) => !paletteSet.has(c))) {
    throw new Error(`All colors must come from preset palette: ${PRESET_PALETTE.join(', ')}`);
  }
  const bundle = {
    bundleId: uuid_(),
    name,
    style,
    label1: labels[0], label2: labels[1], label3: labels[2], label4: labels[3], label5: labels[4],
    color1: colors[0], color2: colors[1], color3: colors[2], color4: colors[3], color5: colors[4],
    createdBy,
    createdAt: nowIso_(),
  };
  const ss = SpreadsheetApp.openById(CONFIG.BUNDLES_SHEET_ID);
  appendRow_(getTab_(ss, TABS.BUNDLES), HEADERS.BUNDLES, bundle);
  return bundle;
}

/** Fixed swatches teachers can pick from when authoring new bundles. */
const PRESET_PALETTE = [
  '#F4B400', // amber
  '#DB4437', // red
  '#0F9D58', // green
  '#4285F4', // blue
  '#AB47BC', // purple
  '#FF7043', // deep orange
  '#26A69A', // teal
  '#8D6E63', // brown
];
