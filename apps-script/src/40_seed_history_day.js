/** Ships pre-built. Called by setup() if no bundles exist yet. */

const HISTORY_DAY_BUNDLE = {
  name: 'History Day',
  style: 'mla',
  labels: ['Background', 'Build-Up', 'Main Event', 'Short-Term Impact', 'Long-Term Impact'],
  // Colors picked from PRESET_PALETTE so the validator passes.
  colors: ['#F4B400', '#FF7043', '#DB4437', '#4285F4', '#AB47BC'],
};

function seedHistoryDayBundleIfMissing_() {
  const existing = listBundles_().find((b) => b.name === HISTORY_DAY_BUNDLE.name);
  if (existing) return existing;
  return createBundle_({
    name: HISTORY_DAY_BUNDLE.name,
    style: HISTORY_DAY_BUNDLE.style,
    labels: HISTORY_DAY_BUNDLE.labels,
    colors: HISTORY_DAY_BUNDLE.colors,
    createdBy: CONFIG.OWNER_EMAIL || Session.getEffectiveUser().getEmail(),
  });
}
