# How to re-upload the Chrome extension for review

Quick reminder for future Paul. Full detail lives in CLAUDE.md §13.

## Steps

1. **Bump + build the zip** (never hand-zip; the script strips the `key` field
   the Web Store rejects):

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\build-extension-zip.ps1 -Bump
   ```

   `-Bump` increments the manifest patch version — the Web Store **rejects**
   an upload whose version didn't increase. **Commit the bumped
   `extension/manifest.json`.**

2. **Upload the zip** from `extension/dist/ops-research-tool-v<version>.zip`
   at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   — sign in with the **district account** (`paul.ivers@orono.k12.mn.us`).
   Item: **OPS Research Tool**, id `goglhlpppkhiddkhgcknbiohcppgdggi`.

3. **Submit for review.** Visibility stays **Private** (restricted to
   `orono.k12.mn.us`), which keeps review fast.

4. **Done — nothing to do on student machines.** Chrome auto-updates
   installed/force-installed extensions within a few hours of approval.

## Gotchas

- Only re-upload when the **extension's own code** changed (`extension/`
  content scripts, popup, PDF panel, manifest, icons). Server-side Apps
  Script changes deploy via push to `main` — no extension upload needed.
- The published id (`goglh…`) differs from the unpacked-dev id (`nmela…`).
  The OAuth client's Application ID must match the **published** id for
  student sign-in to work.
- The signing key `ops-research-tool-extension-key.pem` lives on the Desktop,
  outside the repo — never commit it.
