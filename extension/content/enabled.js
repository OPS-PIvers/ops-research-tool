/**
 * Global on/off gate for the on-page surfaces (selection toolbar + sidebar
 * launcher). The extension is OFF by default so a force-installed (district-wide)
 * copy is dormant on install — no toolbar, no launcher — until the student
 * flips it ON from the popup to start a research unit. State is a single
 * global boolean in chrome.storage.local ('extensionEnabled'), so the toggle
 * applies across every tab and survives restarts.
 *
 * Content scripts evaluate synchronously but storage reads are async, so this
 * exposes an optimistic cached value (defaults false), a ready promise, and a
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
  let enabled = false; // optimistic OFF until storage resolves (off by default)
  const listeners = [];

  const ready = chrome.storage.local.get(STORAGE_KEY)
    .then((r) => {
      enabled = r[STORAGE_KEY] === true;
      // Notify subscribers that registered before the async read settled —
      // without this, a consumer that sampled get() early sees the optimistic
      // OFF forever and the extension stays dormant even when switched ON.
      if (enabled) listeners.forEach((fn) => { try { fn(enabled); } catch (e) {} });
      return enabled;
    })
    .catch(() => enabled);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    enabled = changes[STORAGE_KEY].newValue === true;
    listeners.forEach((fn) => { try { fn(enabled); } catch (e) {} });
  });

  self.OpsEnabled = {
    get: () => enabled,
    ready: () => ready,
    onChange: (fn) => { listeners.push(fn); },
    STORAGE_KEY,
  };
})();
