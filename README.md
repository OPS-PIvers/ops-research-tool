# OPS Research Tool

Internal research tool for Orono Public Schools — replaces Scrible for National
History Day (7th grade) and the 8th-grade capstone project, with future room for
AP Research and similar.

A Chrome extension lets students highlight and categorize web sources; a Google
Apps Script backend stores everything in Google Sheets under a district-owned
Shared Drive; a Docs sidebar drives the writing phase and inserts an annotated
bibliography; a teacher web console manages projects, groups, and a visual
class dashboard.

All data stays inside the district's existing Google Workspace for Education
agreement — no Firebase, no non-core services.

## Status

Pre-pilot. v1 in development. Build plan in [`docs/build-plan.md`](docs/build-plan.md).

| Phase | Description | Status |
| --- | --- | --- |
| 1 | Backend, schema, roster, provisioning | **complete** (round-trip + idempotency + URL-dedup tests green) |
| 2 | Chrome extension (MV3 + offline buffer + PDF.js) | **code-complete** (pending QA + GAS deploy/OAuth setup) |
| 3 | Google Docs sidebar | **code-complete** |
| 4 | Teacher console + pilot | *console complete*, pilot fall 2026 |

See [`CLAUDE.md`](CLAUDE.md) for current build state, the decisions log, and
the next-session start guide.

## Repository layout

```
ops-research-tool/
├── apps-script/        # Google Apps Script project (backend, sidebar, console)
│   └── src/            # .js files pushed via clasp
├── extension/          # Chrome extension (Manifest V3)
├── docs/               # Build plan, design notes, architecture
└── README.md
```

## Local development

### Prereqs

- Node.js LTS (20+)
- npm
- [clasp](https://github.com/google/clasp) — `npm install -g @google/clasp`
- A Google account with Apps Script API enabled
  (visit <https://script.google.com/home/usersettings>)
- Chrome (for extension dev)

### Apps Script (backend / sidebar / console)

```sh
cd apps-script
clasp login          # one-time, opens a browser
clasp push           # uploads src/ to the bound Apps Script project
clasp open           # opens the project in the Apps Script editor
```

The Apps Script project is bound to a single config block (see
`apps-script/src/00_config.js`). Edit IDs there — never hardcode IDs
elsewhere.

### Chrome extension

```sh
cd extension
# Load extension/ as an unpacked extension at chrome://extensions
```

## Publishing

[`.github/workflows/publish-extension.yml`](.github/workflows/publish-extension.yml)
publishes the extension whenever a push to `main` raises `version` in
`extension/manifest.json` (`scripts\build-extension-zip.ps1 -Bump`, then merge):

- It compares the version with the one before the push, so a push that doesn't
  raise it publishes nothing.
- It builds the zip with `scripts/build-extension-zip.ps1`, uploads it to the
  listing in the `CWS_EXTENSION_ID` repository variable and submits it for
  review. Merging is the approval; there is no manual gate in GitHub.
- The run keeps the uploaded zip as an artifact for 90 days.
- Re-run by hand from Actions > Publish Chrome Extension > Run workflow (on
  `main`). The Web Store refuses a version it already has, so a re-run only
  helps when the last upload never reached it.
- Web Store review still comes before Chrome updates installs.
- `scripts/publish-extension.js` does the upload with the Chrome Web Store API
  v2 (`scripts/web-store.js`, tests in
  `node scripts/test/web-store.node.test.js`). If anything is missing it stops
  with one sentence naming it.

One-time setup:

1. In a Google Cloud project (`ops-research-tool` works), enable the
   **Chrome Web Store API** and make sure the OAuth consent screen is
   **Internal**.
2. Create an OAuth client ID of type **Web application**, with
   `https://developers.google.com/oauthplayground` as an authorized redirect URI.
3. Get a refresh token: open the
   [OAuth 2.0 Playground](https://developers.google.com/oauthplayground), click
   the gear, tick **Use your own OAuth credentials** and paste the client ID and
   secret. Authorize the scope `https://www.googleapis.com/auth/chromewebstore`
   while signed in as the Web Store developer account, then **Exchange
   authorization code for tokens** and copy the refresh token.
4. Copy the publisher ID from the
   [Developer Dashboard](https://chrome.google.com/webstore/devconsole) >
   Publisher > Settings.
5. In this repo, Settings > Environments > **New environment**
   `chrome-web-store`. Under Deployment branches and tags pick **Selected
   branches and tags** and add `main`. Add the environment secrets
   `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` and
   `CWS_PUBLISHER_ID`.
6. Settings > Secrets and variables > Actions > Variables: add the repository
   variable `CWS_EXTENSION_ID` = `goglhlpppkhiddkhgcknbiohcppgdggi`.

## Ownership & data

- **PoC:** all Sheets and folders may be owned by the developer's personal
  Google account.
- **Hard gate before pilot:** migrate to the district Shared Drive. The config
  block makes this a five-minute change.
- Student data lives in per-student Sheets under per-class folders under a
  per-project root folder. One Sheet per student eliminates write contention.

## License

Internal to Orono Public Schools.
