# CLAUDE.md — handoff for the next session

Project-specific guidance for any Claude Code session working on this repo.
The original spec is [`docs/build-plan.md`](docs/build-plan.md) — treat it as
settled. This file is the **live state**: what's built, what was decided in
flight, what to do next.

## 1. What this is in one paragraph

Internal research tool for Orono Public Schools — a Scrible replacement for
National History Day (7th grade) and the 8th-grade capstone, with future room
for AP Research. A Chrome extension lets students highlight + categorize web
sources; a Google Apps Script backend stores everything in Sheets in the
district's Workspace; a Docs sidebar drives the writing phase and inserts an
annotated bibliography; a teacher web console manages projects, groups, and a
visual dashboard. All data stays in the district's existing Workspace for
Education agreement — no Firebase, no non-core services.

## 2. Where things live

| What | Where |
| --- | --- |
| Repo (local) | `C:\dev\ops-research-tool` |
| Repo (GitHub) | https://github.com/OPS-PIvers/ops-research-tool (private) |
| Apps Script project | https://script.google.com/d/1IFhm0FJNiXSeDKGS8VnDfkhs8VY6ueWmHIvc6CIda1AcFXrh1skow2E3/edit |
| Root Drive folder | `13bA8j83R-wZDaewWcOpYisWxH_Ojwhu4` (in Paul's district My Drive) |
| Roster + Staff workbook | `17vs9bb7oFoiT_D7Z4z2vQfLzWyEpLMd21ZWUDovSvEs` |
| Projects registry | `1FSCdO5zcnGhIr5Wdm4-YFSSIcjskWlivffm-ivkJvKE` |
| Bundles config | `1Ht6ggmLyqD-VhepLr10bE8lO28zLX9-1NcfXirxHIYk` |
| GAS owner | `paul.ivers@orono.k12.mn.us` (district account, not personal) |
| GitHub user | `OPS-PIvers` |

All IDs are also hardcoded into [`apps-script/src/00_config.js`](apps-script/src/00_config.js).
Moving the project = edit that one file, `clasp push`, redeploy.

## 3. Phase status

- **Phase 1 — Backend, schema, roster, provisioning — COMPLETE.**
  - `doPost` batch upsert with lazy per-(student, project) Sheet provisioning.
  - `doGet` action dispatcher: `me`, `projects`, `bundles`, `mySources`,
    `myHighlights`, `findSource`.
  - Idempotent writes keyed on client-generated UUIDs.
  - Source dedup by normalized URL (extension calls `findSource` before
    creating a new source).
  - History Day bundle seeded.
  - Editor tests `devTestRoundTrip`, `devTestNormalizeUrl` (8/8),
    `devTestSourceDedup` all green.
- **Phase 2 — Chrome extension — NEXT.** Answered setup questions:
  vanilla JS no bundler, `chrome.identity.getAuthToken` + Bearer header,
  PDF.js self-hosted in `extension/vendor/`. See §6 below.
- **Phase 3 — Google Docs sidebar — not started.**
- **Phase 4 — Teacher Console + pilot — not started.**

## 4. Decisions made beyond the build plan

These supersede or refine the spec — apply them before defaulting to plan text.

- **PoC → Shared Drive migration gate is DISSOLVED.** Paul authorized clasp
  with his **district account** from day one. All Drive artifacts live under
  `paul.ivers@orono.k12.mn.us`'s district My Drive. Risk #3 in the build
  plan's risk register is structurally mitigated. The config block still
  exists to make any future move to a true Shared Drive trivial.
- **Repo name is `ops-research-tool`** (not "nhd-research-tool" as the plan
  doc title suggests). Broader scope name — covers capstone + AP Research.
- **Per-(student, project) Sheets** named exactly `[email]` per build plan §3.
  Sheet contains three tabs: `Meta` (one row), `Sources`, `Highlights`.
- **Citation fields are stored as JSON** in the `citationFields` column of
  `Sources` (build plan said "structured"; this is the implementation).
- **Identity stamping happens server-side.** `doPost` overrides the client's
  `createdByEmail` with `Session.getActiveUser().getEmail()`. Never trust the
  client's claim of who they are.

## 5. GAS V8 quirks discovered

- `new URL(...)` **throws** in GAS V8. The global is advertised but unusable.
  `URLSearchParams` mutations also don't take. Hand-parse URLs with regex —
  see [`normalizeUrl_`](apps-script/src/03_utils.js) for the working pattern.
- Side effect: always ship behavior-asserting unit tests as editor-callable
  `devTest*` functions. Functions that "don't throw" can still be silently
  returning wrong values.

## 6. Phase 2 setup decisions (answered, not yet implemented)

- Stack: **vanilla JS, no bundler**. Plain MV3. Edit-and-reload workflow.
- Auth: **`chrome.identity.getAuthToken({interactive: true})` → `Authorization: Bearer <token>`**.
  The manifest needs an `oauth2` block with the OAuth client ID from the
  GAS project's GCP project (same one clasp uses) + scopes matching what the
  Web App needs (likely just `https://www.googleapis.com/auth/userinfo.email`
  for identification, since the GAS executes as Paul).
- PDF.js: **self-hosted in `extension/vendor/`** (pdf.min.js + pdf.worker.min.js).
  ~1MB but works offline and no CSP escape hatches.

## 7. Open items / blockers before Phase 2 can fully work

1. **Publish the first Web App deployment from the GAS editor** (one-time
   manual step — the CI workflow can only *update* an existing deployment,
   not create it). Editor → **Deploy → New deployment → Web app**, Execute
   as: **Me**, Access: **Anyone within `orono.k12.mn.us`**. Save. Then:
   - Copy the `/exec` URL → it goes in `extension/config.js`.
   - Copy the deployment ID (looks like `AKfycb...`, ~50 chars) → add it as
     a repo *variable* named `GAS_DEPLOYMENT_ID` (see §12 for setup).
2. **Configure CI secrets** so the deploy workflow can run — see §12.
3. **Grab the OAuth client ID** from the GCP project linked to the GAS, for
   the extension manifest's `oauth2` block. May require enabling the Apps
   Script API in the linked GCP project (separate from the per-user toggle
   Paul already did).
4. **Confirm Class strings** when Paul has a real roster sample —
   `validateRoster()` only checks blank/duplicate emails today; consistency
   of Class strings (no leading/trailing whitespace, casing) hasn't been
   validated against real data yet.

## 8. How to push / test from this repo

```powershell
# Refresh PATH each PowerShell tool call — winget-installed binaries aren't
# in the inherited env yet:
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# Push Apps Script
cd C:\dev\ops-research-tool\apps-script
clasp push -f

# Open the GAS editor
clasp open

# Git
cd C:\dev\ops-research-tool
git add ...
git commit -m "..."
git push
```

Editor-callable tests in [`apps-script/src/99_dev.js`](apps-script/src/99_dev.js):
- `devSeedDevProject` — adds Paul to roster as a fake "DEV" student + admin,
  creates a Dev Project if missing
- `devTestRoundTrip` — full doPost → readback → idempotency cycle
- `devTestNormalizeUrl` — 8 cases, all should PASS
- `devTestSourceDedup` — confirms two URLs differing only in tracking params
  resolve to the same source
- `devProbeUrlConstructor` — diagnostic for the GAS URL quirk
- `devValidateRoster` — runs roster + staff validation

## 9. How to start a Phase 2 session

1. Read this file.
2. Read [`docs/build-plan.md`](docs/build-plan.md) §5 Phase 2 and the
   highlighting / offline buffer / PDF sections of §2 for the requirements.
3. Confirm Phase 1 hasn't regressed: run `devTestRoundTrip` and
   `devTestNormalizeUrl` from the GAS editor.
4. Address the §7 blockers (deploy web app, grab oauth client id) before
   writing extension code that depends on them.
5. Scaffold `extension/` per §6 decisions:
   ```
   extension/
   ├── manifest.json          # MV3, host_permissions for <all_urls>, oauth2 block
   ├── background.js          # service worker — sync queue drain, chrome.alarms
   ├── content/
   │   ├── toolbar.js         # the swatch popup on text selection
   │   ├── marks.js           # in-session colored spans
   │   └── scrape.js          # meta-tag scraping (title, og:site_name, etc.)
   ├── popup/                 # the toolbar popup (project selector, sync status)
   ├── pdf/                   # PDF.js panel (Tier 2)
   ├── vendor/                # pdf.min.js + pdf.worker.min.js
   ├── shared/
   │   ├── api.js             # fetch wrapper around the GAS Web App
   │   ├── storage.js         # chrome.storage.local + sync queue
   │   └── ids.js             # UUID generation
   └── config.js              # WEB_APP_URL + OAUTH_CLIENT_ID
   ```
6. Build the offline buffer (`shared/storage.js`) FIRST — every highlight
   must write to `chrome.storage.local` synchronously before any network
   call. This is what kills the Scrible "lost work" bug.
7. Build the sync queue (`background.js`) SECOND. Drains the buffer with
   retry/backoff to the GAS `doPost`. Idempotent because IDs are UUIDs
   generated client-side.

## 10. Out-of-scope reminders (don't drift)

- **v1 MLA only.** Citation module is a dispatcher — Chicago/APA are
  drop-in functions added later.
- **4 source types** (website, article, book, primary) for MLA. No more.
- **No "insert as quote" button** in the Docs sidebar. Only "Insert
  Bibliography". This is intentional.
- **No re-anchoring** of highlights on page revisits. Marks are session-only;
  data is safe server-side. Don't try to be clever here.
- **No OCR for scanned PDFs.** Detect the missing text layer, show a clear
  message, fall back to Tier 1.
- **Bundles are immutable** once created. Editing = creating a new bundle.
- **Teacher dashboard counts primary category only.** Secondary tags affect
  sidebar filtering, never dashboard stats.

## 11. CI / deployment

GitHub Actions workflow: [`.github/workflows/deploy-apps-script.yml`](.github/workflows/deploy-apps-script.yml).

**What it does:** on every push to `main` that touches `apps-script/**`,
installs clasp, pushes the source, and (if a deployment ID is configured)
redeploys the active Web App with a new version. Also triggerable manually
from the Actions tab.

**One-time secrets/variables setup** (Settings → Secrets and variables → Actions):

| Kind | Name | Where to get it |
| --- | --- | --- |
| Secret | `CLASPRC_JSON` | Run `Get-Content $HOME\.clasprc.json` in PowerShell after a local `clasp login`. Paste the full JSON. Contains the refresh token clasp needs to mint access tokens in CI. Rotate by running `clasp login` again locally and updating the secret. |
| Variable | `GAS_DEPLOYMENT_ID` | GAS editor → **Deploy → Manage deployments** → pick the Web App deployment → copy the **Deployment ID** (NOT the version number, NOT the `/exec` URL). |

If `GAS_DEPLOYMENT_ID` is unset the workflow still pushes code but skips
the deploy step — useful while iterating before the first Web App exists.

**Manual trigger:** Actions tab → "Deploy Apps Script" → Run workflow.

**Concurrency:** the workflow is grouped (`gas-deploy`) so overlapping
deploys serialize instead of racing.

## 12. Paul

Builder-of-one for district internal tools. Experienced with Apps Script —
don't over-explain GAS-side things. Comfortable delegating environment setup
(clasp, gh, OAuth flows). Likes terse responses; avoid trailing summaries.
Knows the OPS brand guidelines — use the `anthropic-skills:ops-brand-guidelines`
skill for any district-facing UI (Teacher Console in Phase 4).
