/**
 * Global on/off gate for the on-page surfaces (selection toolbar + sidebar
 * launcher). The extension is ON by default; the student flips it from the
 * popup when the perpetual toolbar/launcher gets in the way. State is a single
 * global boolean in chrome.storage.local ('extensionEnabled'), so the toggle
 * applies across every tab and survives restarts.
 *
 * Content scripts evaluate synchronously but storage reads are async, so this
 * exposes an optimistic cached value (defaults true), a ready promise, and a
 * change subscription. Consumers gate lazily — at selection / page-load time —
 * not at script-eval time, so the read has settled by the time it matters and
 * live toggles take effect without a page reload.
 *
 * Deliberately NOT loaded in the PDF panel: a student who opened the panel to
 * highlight a PDF should always have it work. Consumers guard with
 * `self.OpsEnabled && ...`, so the panel (where OpsEnabled is absent) is never
 * gated.
 */
(function () {
  const STORAGE_KEY = 'extensionEnabled';
  let enabled = true; // optimistic until storage resolves
  const listeners = [];

  const ready = chrome.storage.local.get(STORAGE_KEY)
    .then((r) => { enabled = r[STORAGE_KEY] !== false; return enabled; })
    .catch(() => enabled);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    enabled = changes[STORAGE_KEY].newValue !== false;
    listeners.forEach((fn) => { try { fn(enabled); } catch (e) {} });
  });

  self.OpsEnabled = {
    get: () => enabled,
    ready: () => ready,
    onChange: (fn) => { listeners.push(fn); },
    STORAGE_KEY,
  };
})();
