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
| Repo (local) | `C:\Users\paul.ivers\Desktop\ops-research-tool` |
| Repo (GitHub) | https://github.com/OPS-PIvers/ops-research-tool (private) |
| Apps Script project | https://script.google.com/d/1IFhm0FJNiXSeDKGS8VnDfkhs8VY6ueWmHIvc6CIda1AcFXrh1skow2E3/edit |
| Root Drive folder | `13bA8j83R-wZDaewWcOpYisWxH_Ojwhu4` (in Paul's district My Drive) |
| Roster + Staff workbook | `17vs9bb7oFoiT_D7Z4z2vQfLzWyEpLMd21ZWUDovSvEs` |
| Projects registry | `1FSCdO5zcnGhIr5Wdm4-YFSSIcjskWlivffm-ivkJvKE` |
| Bundles config | `1Ht6ggmLyqD-VhepLr10bE8lO28zLX9-1NcfXirxHIYk` |
| GAS owner | `paul.ivers@orono.k12.mn.us` (district account, not personal) |
| GitHub user | `OPS-PIvers` |
| Chrome extension ID (fixed) | `nmelakoijagkfanhilcnagkochhfmacn` — pinned by the `key` in [`extension/manifest.json`](extension/manifest.json) |
| Extension signing key (private) | `C:\Users\paul.ivers\Desktop\ops-research-tool-extension-key.pem` — **outside the repo, never commit.** Back it up (password manager / Drive). |

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
- **Phase 2 — Chrome extension — CODE COMPLETE; loadable and authenticating.**
  - OAuth client ID + Web App `/exec` URL are wired into
    [`extension/config.js`](extension/config.js) and
    [`extension/manifest.json`](extension/manifest.json). The old §7 deploy /
    OAuth / extension-ID blockers are resolved.
  - Vanilla JS MV3 scaffold under [`extension/`](extension/).
  - Offline buffer: `chrome.storage.local` queue (`q:<uuid>`), synchronous
    enqueue, service-worker drain with exponential backoff + idempotent
    retries. Build plan §2 "kills Scrible lost-work bug" invariant satisfied.
  - Sync queue: drains on `chrome.alarms` (1 min) AND on `chrome.storage`
    change (immediate kick). Grouped POST per projectId via the GAS doPost.
  - Auth: `chrome.identity.getAuthToken` + Bearer header, 401 retry once,
    cached token invalidation on failure.
  - Source dedup: in-session cache + `findSource` lookup → mint new if absent.
  - Content scripts: `mouseup`/`keyup` selection → floating toolbar with the
    bundle's 5 swatches → wrap selection in `<span class="ops-research-mark">`
    (in-session only, vanishes on reload per spec). Optional note. Click
    on mark messages a sidebar to focus (no-op if absent).
  - Popup: identity surface, project picker (sticky), sync status pill,
    bundle preview, "Sync now" button.
  - PDF Tier 2: [`extension/pdf/panel.html`](extension/pdf/panel.html) — own
    panel page. Background fetches PDF bytes (base64-shipped to panel),
    PDF.js v4.7.76 self-hosted in [`extension/vendor/`](extension/vendor/),
    text extracted per page with `getTextContent` + `hasEOL`, rendered as
    selectable paragraphs. Toolbar works inside the panel (same scripts).
    Empty-state for scanned PDFs ("no extractable text — save manually");
    "Save as source" button = Tier 1 fallback (creates source row, no
    highlights). Popup detects PDF tabs and shows a CTA button.
  - In-page sidebar refresh — **code-complete on branch `sidebar-refresh`,
    pending pilot QA** (not yet merged to `main`). Two tabs under the project
    line: **Source** (citation form mirroring the Docs editor — source-type +
    per-type fields + primary/secondary segmented control + annotation + live
    MLA preview; autosaves through the sync queue; reachable only once the page
    has a source, i.e. after the first highlight) and **Annotations** (the
    existing highlight list). The bulky wrapping filter pills are replaced by a
    compact **vertical facet list** (All notes + 5 categories, swatch · label ·
    count, empty categories dimmed). Deleting the **last** note for a source no
    longer silently cascades — a confirm **toast** offers Keep (default) /
    Delete source. See §4 (in-extension citation editing) and the design/plan
    in [`docs/superpowers/`](docs/superpowers/).
  - **Code-complete.** Still TODO in Phase 2: real-page QA (news sites,
    databases, PDFs, edge cases like shadow-DOM-heavy pages) — now including the
    `sidebar-refresh` tabs/filter/toast; force-install setup with the district
    Admin console; possible polish on roster-not-found UX.
- **Phase 3 — Google Docs sidebar — CODE COMPLETE.**
  - Editor add-on entry points in
    [`50_docs_addon.js`](apps-script/src/50_docs_addon.js): `onInstall` /
    `onOpen` add the "OPS Research Tool → Open research panel" menu;
    `showSidebar` pops `sidebar.html` (360px).
  - Sidebar UI: [`sidebar.html`](apps-script/src/sidebar.html) +
    [`sidebar_css.html`](apps-script/src/sidebar_css.html) +
    [`sidebar_js.html`](apps-script/src/sidebar_js.html). Project picker
    (staff see all active projects, students see their class's), sources
    grouped with their highlights, per-source citation form.
  - Per-source editor modal:
    [`source_editor.html`](apps-script/src/source_editor.html) +
    [`source_editor_js.html`](apps-script/src/source_editor_js.html), launched
    by `sidebarOpenSourceEditor` (820x720), bundle swatches embedded.
  - Server API in [`53_sidebar_api.js`](apps-script/src/53_sidebar_api.js)
    (all `sidebar*`, identity via `Session.getActiveUser()`): `sidebarGetContext`,
    `sidebarGetProjectData`, `sidebarUpdateSource` (allow-listed fields only),
    `sidebarUpdateHighlight`, `sidebarDeleteHighlight` (+ orphan cascade),
    `sidebarDeleteSource` (batched filter-rewrite), `sidebarPreviewCitation`,
    `sidebarInsertInlineCitation`, `sidebarInsertBibliography`.
  - Citation formatter [`51_citation.js`](apps-script/src/51_citation.js):
    `formatCitation(fields, style)` → `{ text, italics: [[start,end],...] }`.
    **MLA 9 only** (v1); dispatcher switches on `style` so Chicago/APA are
    drop-in later.
  - Bibliography inserter
    [`52_bibliography.js`](apps-script/src/52_bibliography.js):
    `insertAnnotatedBibliography` splits Primary/Secondary, alphabetizes by
    author-last/title, applies italics ranges + MLA hanging indent, inserts at
    cursor. Inclusion is decided by `partitionBibliographySources_`: unclassified
    sources are always skipped (hard validation per build plan §2), and the
    annotated variant additionally skips classified-but-un-annotated sources;
    the sidebar shows a confirm warning listing the omissions before inserting
    (see §4). `insertInlineCitation` for in-text parentheticals. **No "insert as
    quote" button** — intentional.
  - **Still TODO in Phase 3:** install the editor add-on (dev: Deploy → Test
    deployments → Editor Add-on; prod: Marketplace SDK, domain-restricted to
    `orono.k12.mn.us`); real-Doc QA of bibliography formatting + cursor
    insertion; wire the extension's `focusHighlight` message (see §9) to the
    sidebar.
- **Phase 4 — Teacher Console — sub-projects A/B/C/D COMPLETE.**
  - A+B: Console shell, My Projects, Project Dashboard, student drill-down.
  - C: Admin Area (Roster CRUD, Staff CRUD, Archive School Year) + audit log
    + 7-day recently-unarchived banner.
  - D: Groups — teacher-driven merge of 2–4 in-class students into a single
    group Sheet (existing work migrated), Manage Groups mode on the dashboard
    (merge / move / add / remove / disband), group-aggregate drill-down with
    author attribution. Routing goes through `findGroupSheetForStudent_` so the
    extension + sidebar work transparently for group members. Source dedup on
    merge is intentionally NOT done (build plan §Groups lock).
    - **Un-merge reconstructs from the group, not an archive.** Disband /
      remove / move rebuild a member's solo Sheet from the group's rows
      filtered by `createdByEmail` (+ the referential closure of any source a
      member's highlight cites), so group-period work follows the student
      out. Merge therefore *trashes* the per-student Sheets — the group Sheet
      is the sole store. `reconstructSoloFromGroup_` + the solo cores
      (`findOrCreateSoloSheet_` / `getSoloSheetIfExists_`, which bypass group
      routing) do the rebuild.
    - **Move** carries the student's work into the target group; **remove**
      auto-disbands a group that would drop to ≤1 member.
    - **`consoleAddToGroup`** adds an ungrouped same-class student to an
      existing group (copies their solo rows in, trashes the solo). In the
      dashboard's Manage Groups bar, the "Move to ▾" button doubles as "Add
      to group ▾" when the selected student is solo; "Remove from group"
      removes a selected grouped student.
    - All group mutations are serialized with `LockService` (`withGroupLock_`).
  - **Known follow-ups:**
    - `consoleGroupCheckIntegrity` is admin-only and editor-callable; no
      client UI yet — surface if pilot reveals it's needed.
    - Group renaming — trivial follow-up; no schema change required.
    - Sidebar currently allows any group member to delete highlights they
      didn't author. Document only; gate later if pilot reveals abuse.
  - **Pilot — still TODO** (force-install + run one section).

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
- **Citation scrape is richer than build-plan §122-126.** The plan specified
  only `document.title` + a few OG/legacy meta tags, which auto-filled almost
  nothing. [`scrape.js`](extension/content/scrape.js) now ALSO reads **JSON-LD**
  (`Article`/`NewsArticle`/`ScholarlyArticle`/`Book`) and **Highwire/Dublin
  Core** (`citation_*`, `DC.*`) tags — the channels news sites and academic
  databases actually emit author/date/publication/volume/issue/pages on — plus
  infers `sourceType` and strips the site suffix from the title. Still within
  the plan's intent: standard structured metadata only, **no readability
  library**, student still verifies. The four original fields stay in the
  discrete `scraped*` columns; the richer fields ride in a new **`scrapedExtra`
  JSON column** (mirrors `citationFields`) and pre-fill the sidebar citation
  form ([`source_editor_js.html`](apps-script/src/source_editor_js.html)).
- **`ensureHeaders_` auto-heals a pure trailing append.** It used to throw on
  ANY header diff, so adding `scrapedExtra` would have broken writes to every
  already-provisioned Sheet. It now writes labels for new trailing columns in
  place (never reorders/relabels existing data) and still throws on a real
  reorder/rename. `scrapedExtra` therefore self-migrates on the next write — no
  migration script to run. Column mapping is positional via the `HEADERS`
  constant, so even write paths that skip `ensureHeaders_` stay correct; the
  header row is cosmetic.
- **PDF citation auto-fill comes from the file, not the page.** A PDF has no
  HTML `<meta>`/JSON-LD, so `scrape.js` finds nothing — author/date came back
  blank. The Tier-2 panel now extracts citation metadata two ways in
  [`panel.js`](extension/pdf/panel.js) and stashes `{title, author, date}` on
  `window.OPS_PDF_META` (merged by [`shim.js`](extension/pdf/shim.js)'s
  `scrapePageMeta` override, filling only empty fields — title stays the
  filename since embedded PDF titles are usually junk):
  1. **Embedded metadata** (`extractPdfMeta_`): PDF.js `getMetadata()` → Info
     dict (`Title`/`Author`/`CreationDate`) + XMP fallback. Authoritative when
     present.
  2. **Conservative page-1 body heuristics** (`extractPdfBodyHints_`): font-size
     line grouping → largest line is the title, name-shaped lines just below are
     the author block, dated lines anywhere give the date (copyright-year
     preferred to dodge "Received…Accepted…" ambiguity). Hard-gated: returns
     BLANK rather than guess (a wrong author a student trusts is worse than an
     empty field). DOM-side, so no GAS test — real-PDF QA only.
- **Source writes are self-healing against cross-surface deletes.** Deleting a
  source from the Docs sidebar is purely server-side and never touched the
  extension's persistent `pageSource:` cache, so a re-save hit the stale cache,
  skipped creating the source row, and left invisible orphan highlights.
  [`background.js`](extension/background.js) `getOrCreateSourceId` now ALWAYS
  idempotently re-asserts the source row (deduped in the queue), reusing the
  cached id so orphans reattach. This is only safe because
  [`upsertSource_`](apps-script/src/20_writes.js) now PRESERVES sidebar-owned
  fields (citation, annotation, primary/secondary, sourceType) on existing rows
  — a scrape re-assert can never wipe a student's citation work. Also:
  `loadPageHighlights_` seeds the local cache from the server match on page
  visit, so a NEW highlight on a second device merges into the existing source
  instead of duplicating it (the long-claimed-but-unwired `findSource` dedup is
  still NOT wired; this covers the same ground without a save-path round-trip).
- **Students edit citation fields in the extension, not only the Docs sidebar**
  (branch `sidebar-refresh`, pending QA). The in-page sidebar's **Source tab**
  reuses the SAME field set + precedence as
  [`source_editor_js.html`](apps-script/src/source_editor_js.html) so the two
  surfaces never drift. Writes go through the existing queue → `upsertSource_`
  (no new write endpoint): the Source tab sends a full source upsert carrying
  citation fields; `upsertSource_`'s field-merge makes those win while a scrape
  re-assert (which omits them) preserves them — the same invariant §"self-healing"
  relies on, now locked by `devTestCitationSurvivesReassert`. `citationFields`
  stores only fields the student explicitly set (a deliberately-cleared field is
  kept as an empty string, distinct from "never set", so a wrong scraped value a
  student deletes does not reappear). Two small backend additions: a read-only
  `previewCitation` GET (wraps `formatCitation` — single source of truth, no JS
  fork) and a `kind:'source'` branch in the `doPost` deletes loop (orphan-safe,
  via `deleteSourceIfOrphaned_`) backing the last-note "Delete source" toast.
  The offline queue now **merges** pending same-source writes (sorted by
  `enqueuedAt`) instead of last-write-wins, so a citation edit can't be dropped
  by a later scrape re-assert before draining.
- **Bibliography inclusion keys on annotation too — and omissions are warned,
  not silent.** The **annotated** bibliography includes a source only if it is
  classified primary/secondary **AND** has a non-empty annotation; **Works
  Cited** still keys on classification only (annotations are irrelevant there).
  Unclassified is omitted from both (build plan §2). The rule lives in exactly
  one place — `partitionBibliographySources_`
  ([`52_bibliography.js`](apps-script/src/52_bibliography.js), pure +
  unit-tested by `devTestBibliographyPartition`) — and the Docs sidebar mirrors
  it in `bibliographyOmissions_`
  ([`sidebar_js.html`](apps-script/src/sidebar_js.html)) to show a **blocking
  confirm** listing every source that will be left out and why ("not marked
  Primary or Secondary" / "no annotation written") before inserting; the
  success status reports the left-out count. This refines build plan §2's
  hard-validation (unclassified skipped) to also treat a blank annotation as
  incomplete for the *annotated* variant. Per Paul: the cut behavior is fine,
  but warn so students don't silently forget a source. Server enforces the
  filter regardless; the client warning is UX only — keep the two rules in sync.

- **Docs sidebar + source-editor modal are OPS-brand-aligned.** The shared
  stylesheet [`sidebar_css.html`](apps-script/src/sidebar_css.html) now uses the
  Orono Technology palette (brand blue `#2d3f89` primary / `#1d2a5d` strong, red
  `#ad2122` accent, true-gray neutrals), **Lexend** for titles + **Roboto** for
  body (Google-Fonts `@import` at the top — works in the HtmlService iframe), and
  the OPS focus-ring on form controls. The old Google-Material hexes are gone.
  Semantic CSS vars (`--c-accent`, `--c-good`, etc.) were kept and remapped, so
  rules pick up brand colors without renaming. Primary/secondary/unset now read
  blue/red/gray everywhere (chips + segmented control). Use the
  `anthropic-skills:ops-brand-guidelines` skill + these tokens for any new
  sidebar/modal UI. **Follow-up:** the header is still a styled text wordmark —
  drop in the real OPS Primary Logo (base64-inlined; GAS can't `clasp push` a
  PNG) when the asset is on hand.

- **Source-editor modal: custom dropdown + evidence spacing.** The per-source
  editor's source switcher is a custom OPS-styled trigger + popover listbox
  ([`source_editor.html`](apps-script/src/source_editor.html) +
  [`source_editor_js.html`](apps-script/src/source_editor_js.html)), NOT a
  native `<select>` (whose open menu can't be styled). Matches the
  `.sb-ps-pop` / `.sb-insert-pop` popover language; each option shows a
  `✓` for the current source · a primary/secondary color dot · 2-line-clamped
  title; click/outside-click/Escape/↑↓ wired. The evidence list got a
  `.sb-modal__evidence { gap: 12px }` rule (cards were stacking flush, borders
  abutting). DOM-side — real-Doc QA only.

- **Teacher dashboard reads are PARALLEL (the #1 perf lever).** Build plan §perf
  concern: the dashboard fans out across every student's Sheet, and GAS has no
  threads, so the old serial `openById`+`getValues` loop was O(N) × ~0.5s.
  Now `consoleGetProjectDashboard` ([`61_console_api.js`](apps-script/src/61_console_api.js))
  reads all Sheets CONCURRENTLY via `UrlFetchApp.fetchAll` against the **Drive
  CSV-export endpoint** (`docs.google.com/.../export?format=csv&gid=`,
  [`22_batch_read.js`](apps-script/src/22_batch_read.js)). **Why CSV-export and
  not the Sheets REST API:** the script runs on a *default* (Google-managed) GCP
  project where the Sheets API can't be enabled (Paul can't even `describe` it;
  `gcloud services enable` → PERMISSION_DENIED). CSV-export rides on the **Drive
  scope already granted** (+ `script.external_request`, a one-time re-consent
  added when UrlFetchApp shipped) — no GCP change. Sheet ids + the Sources/
  Highlights **tab gids** come from a `SheetManifest` tab on the Projects
  registry ([`15_sheet_manifest.js`](apps-script/src/15_sheet_manifest.js)),
  written at provisioning (`findOrCreateSoloSheet_`) so the dashboard skips the
  per-student Drive walk; a miss falls back to the Drive walk + backfills. The
  manifest is a **derived cache** — `getManifestTab_` self-heals its own schema
  (clears + rebuilds on any header change; no migration), and group merge/add
  drop entries (`forgetSoloSheetId_`) while un-merge refreshes via
  `findOrCreateSoloSheet_`. Results are cached in `CacheService` for 45s keyed by
  `dash:v1:<projectId>:<sortedScopedClasses>` (Refresh bypasses via a 3rd arg).
  **Resilience:** if the parallel read wholesale-fails (API outage, etc.) the
  endpoint falls back to the preserved serial path `computeDashboardSerial_` —
  correct-but-slow beats fast-but-blank. The console shows a **skeleton table**
  while loading ([`console_js.html`](apps-script/src/console_js.html)
  `buildDashboardSkeleton_`). Locked by `devTestDashboardParityParallelVsSerial`
  (asserts parallel aggregates == serial, byte-for-byte) + `devTestSheetManifestRoundTrip`
  (`devTestDashboardPerfAll` runs both). **Deferred (documented, additive — no
  rewrite to add later):** a precomputed per-project rollup Sheet for O(1)
  dashboards, and per-class fan-out in the client (low ROI after parallel reads;
  duplicates roster/group reads per class; only helps very large multi-class
  admin views). Pull either in only if a whole-grade project proves slow.

- **Demo "Sample data" toggle (admin-only) for the dashboard.** A header toggle
  ([`console_js.html`](apps-script/src/console_js.html) `buildSampleToggle_` →
  `consoleSetSampleData`) seeds ~18 fake students into the **Dev Project's DEV
  class**, each in a deliberately different state so a teacher sees the full
  spectrum of dashboard rows + drill-downs (0% not-started, highlights-only,
  classified-/cited-/annotated-only, 20–100% partials, category-skewed vs
  balanced, sparse vs deep, book/primary types). All server logic is isolated in
  [`67_sample_data.js`](apps-script/src/67_sample_data.js). Mechanics: sample
  students are real roster rows + per-student Sheets, marked by a fake email
  domain (`@sample.oronoresearch`, never authenticates). **Toggle ON lazily
  seeds once** (idempotent — deterministic source/highlight ids; ~20–30s the
  first time as it provisions Sheets), then it's an instant **filter**: every
  console roster read passes through `excludeSampleIfDisabled_`, so when off the
  sample students vanish from the dashboard, project-card counts, and admin
  roster (real students you add always show). State is a ScriptProperty
  (`OPS_SAMPLE_ENABLED`) returned in `consoleGetContext.sampleDataEnabled` and
  folded into the dashboard cache key (`:s0`/`:s1`). The completion metric uses
  the raw `parseCitationFields_` (see §5), so a "cited" sample source writes
  `title`+`url` into `citationFields`. **No groups seeded** (solo students only)
  — demo group drill-down by merging samples live, or add a sample group later.
  Hard teardown (trash Sheets + drop roster rows): `devClearSampleData()` /
  `consoleClearSampleData()`. Toggle is brand-styled (blue on / gray off, no
  stoplight green — that's gap-pills only).

## 5. GAS V8 quirks discovered

- `new URL(...)` **throws** in GAS V8. The global is advertised but unusable.
  `URLSearchParams` mutations also don't take. Hand-parse URLs with regex —
  see [`normalizeUrl_`](apps-script/src/03_utils.js) for the working pattern.
- Side effect: always ship behavior-asserting unit tests as editor-callable
  `devTest*` functions. Functions that "don't throw" can still be silently
  returning wrong values.
- **`google.script.run` silently delivers `null` to the success handler when
  the return payload contains a `Date` object** — its serializer can't carry
  Dates even though `JSON.stringify` can. So a server function that returns
  fine when Run from the editor still breaks the live sidebar (the client gets
  `null`, not a thrown error, so `withFailureHandler` never fires — you just see
  the generic "non-ok" branch). And Sheets **coerces any date-looking cell**
  (e.g. a scraped `"2020-04-16"`) into a `Date` on read via `getValues()`, so a
  Date sneaks into payloads you'd assume are all strings. Flatten every `Date`
  to a string before returning to the client — see `flattenRowDatesForTransfer_`
  in [`53_sidebar_api.js`](apps-script/src/53_sidebar_api.js) (applied to
  `sidebarGetProjectData`'s sources + highlights). `devDiagnoseSidebarData`
  (in [`99_dev.js`](apps-script/src/99_dev.js)) reproduces this server-side and
  flags Date-typed cells in the payload. Any NEW `google.script.run`-returning
  read of raw Sheet rows needs the same treatment.
- **All `.js` files share ONE global namespace; a duplicate top-level
  `function name(){}` silently SHADOWS — the last-loaded file wins** (load order
  ≈ filename order, so `62_*` beats `52_*`). This bit the annotated bibliography:
  `62_aggregator.js` had its own `parseCitationFields_` (parse-only, no `scraped*`
  fallback — correct for the completion *metric*, which must count only what the
  student explicitly entered) that shadowed `52_bibliography.js`'s richer parser,
  so scraped-only sources (`citationFields:'{}'`, data in `scraped*`) rendered as
  **blank citation lines** in the bib while fully-edited sources rendered fine.
  Fix: the render parser is now `buildCitationFields_` (full: JSON + `scraped*`
  fallback + string coercion; in [`52_bibliography.js`](apps-script/src/52_bibliography.js),
  used by the bibliography + inline-citation precompute) and the raw
  `parseCitationFields_` (completion only) keeps its name — distinct names, no
  collision. `61_console_api.js` does its own inline fallback so it's correct
  either way. Locked by `devTestBibliographyCitationFallback`. Lesson: before
  adding a `function foo_()`, grep the whole `src/` for an existing `foo_` — a
  "kept local to avoid a dependency" copy is a shadow waiting to happen.

## 6. Phase 2 setup decisions (answered + implemented)

- Stack: **vanilla JS, no bundler**. Plain MV3. Edit-and-reload workflow.
- Auth: **`chrome.identity.getAuthToken({interactive: true})` → `Authorization: Bearer <token>`**.
  The manifest needs an `oauth2` block with the OAuth client ID from the
  GAS project's GCP project (same one clasp uses) + scopes matching what the
  Web App needs (likely just `https://www.googleapis.com/auth/userinfo.email`
  for identification, since the GAS executes as Paul).
- PDF.js: **self-hosted in `extension/vendor/`** (pdf.min.js + pdf.worker.min.js).
  ~1MB but works offline and no CSP escape hatches.

## 7. Open items / blockers

**Resolved** (kept here as the recipe in case the project ever moves):
- Web App deployment is published; the `/exec` URL is in
  [`extension/config.js`](extension/config.js). To re-publish: Editor →
  **Deploy → New deployment → Web app**, Execute as **Me**, Access **Anyone
  within `orono.k12.mn.us`**. (CI can only *update* an existing deployment,
  not create one.)
- OAuth client ID is set in both
  [`extension/manifest.json`](extension/manifest.json) and
  [`extension/config.js`](extension/config.js). Source: GCP project linked to
  the GAS → **APIs & Services → Credentials** → Chrome-Extension-type OAuth
  client keyed on the unpacked extension's ID.

**Still open:**
1. **Install the Docs editor add-on** (Phase 3). Dev: Editor → **Deploy →
   Test deployments → install as Editor Add-on**. Prod: publish via the GCP
   project's Marketplace SDK, domain-restricted to `orono.k12.mn.us`.
2. **Distribute the Chrome extension** (see §13 for the full recipe). Short
   version: do NOT "Pack extension" (self-hosted `.crx` is a dead path);
   publish privately to the Chrome Web Store and force-install via the Google
   Admin console. The extension ID is now pinned to
   `nmelakoijagkfanhilcnagkochhfmacn` via the manifest `key`, so the existing
   OAuth client must have its Application ID set to that ID.
3. **Verify CI secrets** are set so the deploy workflow runs — `CLASPRC_JSON`
   secret + `GAS_DEPLOYMENT_ID` variable (see §11). Confirm a push to `main`
   touching `apps-script/**` actually redeploys.
4. **Confirm Class strings** against a real roster sample — `validateRoster()`
   only checks blank/duplicate emails today; consistency of Class strings (no
   leading/trailing whitespace, casing) is unvalidated against real data.
5. **Pilot one section end-to-end** (extension → highlight → sidebar →
   bibliography insert, including group-routed members).

## 8. How to push / test from this repo

```powershell
# Refresh PATH each PowerShell tool call — winget-installed binaries aren't
# in the inherited env yet:
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# Push Apps Script
cd C:\Users\paul.ivers\Desktop\ops-research-tool\apps-script
clasp push -f

# Open the GAS editor
clasp open

# Git
cd C:\Users\paul.ivers\Desktop\ops-research-tool
git add ...
git commit -m "..."
git push
```

Editor-callable tests in [`apps-script/src/99_dev.js`](apps-script/src/99_dev.js):
- `devSeedDevProject` — adds Paul to roster as a fake "DEV" student + admin,
  creates a Dev Project if missing
- `devClearSampleData` — hard-removes the demo "Sample data" students (trashes
  their Sheets + drops their roster rows). The header toggle only hides them;
  this is the full teardown. See the §4 sample-data bullet.
- `devTestRoundTrip` — full doPost → readback → idempotency cycle
- `devTestNormalizeUrl` — 8 cases, all should PASS
- `devTestSourceDedup` — confirms two URLs differing only in tracking params
  resolve to the same source
- `devProbeUrlConstructor` — diagnostic for the GAS URL quirk
- `devValidateRoster` — runs roster + staff validation
- `devTestDeleteSource` — sidebar source/highlight cascade-delete
- Extension Source tab (branch `sidebar-refresh`): `devTestPreviewCitation`
  (the `previewCitation` GET wraps `formatCitation` → `{text, italics}`),
  `devTestSourceDeleteViaPost` (`doPost` `kind:'source'` delete — orphan removed,
  referenced source refused), `devTestCitationSurvivesReassert` (locks that a
  citation write survives a later scrape-only re-assert). The Source-tab UI,
  facet filter, and orphan toast are DOM-side — no GAS test; real-page QA only.
- Console (Phase 4 A/B): `devTestConsoleAuth`, `devTestConsoleProjectsFilter`,
  `devTestConsoleCreateProject`, `devTestConsoleDashboardEndToEnd`,
  `devTestAggregateStudent`.
- Admin (Phase 4 C): `devTestAdminAuthGate`, `devTestAdminRosterCrud`,
  `devTestAdminRosterReplace`, `devTestAdminEmailChange`,
  `devTestArchiveSchoolYear`.
- `devTestMlaDateFormatting` — locks the robust published-date parser behind
  `formatMlaDate_` / `yearOnly_` ([`51_citation.js`](apps-script/src/51_citation.js)):
  ordinals ("April 16th, 2020"), separator-less compact dates ("20200416"),
  ISO/US/slash/month-name variants, and verbatim echo of unparseable strings
  ("n.d.", "Spring 2020"). Parses to integer parts — no `new Date()`, so ISO
  dates no longer drift a day under the script timezone.
- Citation scrape: `devTestScrapedExtraRoundTrip` (scrapedExtra JSON column
  stores → reads → surfaces as `scrapedExtraParsed`) and
  `devTestEnsureHeadersAppend` (additive header heal + reorder still throws).
  The DOM-side scraper itself can't run under GAS — exercise
  [`scrape.js`](extension/content/scrape.js) by real-page QA (see §9).
- `devTestBibliographyPartition` — locks `partitionBibliographySources_`, the
  single source of truth for bibliography inclusion (annotated needs classified
  + annotation; Works Cited needs classified only; unclassified always omitted).
  The sidebar mirrors this rule to warn before insert, so a red here means the
  warning and the actual insert have drifted.
- `devTestBibliographyCitationFallback` — locks that a scraped-only source
  (`citationFields:'{}'`, data in `scraped*`) still renders a non-empty citation
  via `buildCitationFields_`, and that the raw `parseCitationFields_` (completion
  metric) deliberately does NOT fall back. Guards the duplicate-name shadowing
  bug in §5 from returning.
- No editor test covers citation/bibliography *formatting* — that's manual
  QA in a real Doc (italics ranges, hanging indent, cursor insertion). The
  inclusion/omission filter IS tested (above); the warning confirm dialog is
  DOM-side — real-Doc QA only.
- Groups (sub-project D) — each builds a DEV-class fixture, asserts, and
  cleans up after itself: `devTestGroupRoutingProvisioning`,
  `devTestGroupMergeMigrationFidelity`, `devTestGroupDisbandRoundTrip`,
  `devTestGroupMoveSemantics`, `devTestGroupAddToGroup`,
  `devTestGroupAuthorizationGate`. **Run `devTestGroupsAll` to run all six in
  one shot** — it prints a single `ALL GREEN` / `NOT GREEN` summary.
- Dashboard performance — **`devTestDashboardPerfAll`** runs both:
  `devTestSheetManifestRoundTrip` (manifest record/load/forget + gid storage +
  self-heal) and `devTestDashboardParityParallelVsSerial` (the keystone — builds
  a DEV fixture with a solo + a 2-member group, asserts the parallel CSV-export
  aggregates are byte-for-byte equal to the serial path). The parallel reader
  needs `script.external_request` (one-time editor re-consent on first run) and
  the Drive scope — but NOT the Sheets API (it uses CSV-export; see §4). A red
  parity line prints the `SERIAL:` vs `PARALLEL:` diff.

## 9. How to start a session here

All four phases are code-complete (§3). The work left is install + QA + pilot
(§7) plus product-quality follow-ups. To get oriented:

1. Read this file, then [`docs/build-plan.md`](docs/build-plan.md) for the
   requirements behind whatever surface you're touching.
2. Confirm nothing regressed: run `devTestRoundTrip`, `devTestNormalizeUrl`,
   and `devTestGroupsAll` from the GAS editor.
3. For district-facing UI, use the `anthropic-skills:ops-brand-guidelines`
   skill (§12).

**Known loose threads, by surface:**
- **Extension:** real-page QA on news sites (paywalled + free), subscription
  databases (after auth), Wikipedia. Most likely edge cases: shadow-DOM-heavy
  pages, ContentEditable surfaces, very restrictive CSPs that block injected
  style.
- **Cross-surface:** the "click an in-session mark to focus its sidebar entry"
  handler in [`extension/content/marks.js`](extension/content/marks.js) sends
  a `focusHighlight` message that nothing listens for yet — wiring the
  extension mark to the live Docs sidebar entry is unbuilt.
- **Sidebar (Phase 3):** any group member can delete highlights they didn't
  author (§3 follow-up); citation correctness on scraped fields is unverified
  against real databases.

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

## 13. Distributing the Chrome extension

**Do NOT use "Pack extension."** The self-hosted `.crx` it produces is blocked
by Chrome on normal/managed profiles — it's a dead path. Distribution goes
through the Chrome Web Store (private) + Google Admin console force-install.

### The fixed extension ID

The extension ID is pinned to **`nmelakoijagkfanhilcnagkochhfmacn`** by the
`key` field in [`extension/manifest.json`](extension/manifest.json). This makes
the **unpacked-dev ID and the published ID identical**, so a single OAuth
client works for both. The matching private key is at
`C:\Users\paul.ivers\Desktop\ops-research-tool-extension-key.pem` (outside the
repo — back it up; you only need it if you ever re-pack manually, the Web Store
re-signs with its own key but the `key` field keeps the ID stable regardless).

### One-time: point the OAuth client at the fixed ID

The OAuth client in the GCP project (APIs & Services → Credentials, the
Chrome-Extension-type client whose ID is in `manifest.json`'s `oauth2` block)
was originally keyed to the path-derived unpacked ID. Set its **Application ID**
to `nmelakoijagkfanhilcnagkochhfmacn`. Until this is done,
`chrome.identity.getAuthToken` will fail with a redirect/clientid mismatch on
**both** the reloaded unpacked extension and the published one. Also set the
**OAuth consent screen to "Internal"** (Workspace-only) so domain users skip
the unverified-app warning — the only scopes are `userinfo.email` + `openid`.

### Publish to the Chrome Web Store (private)

1. Zip the **contents** of `extension/` (manifest.json at the zip root, not a
   nested `extension/` folder).
2. [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   → upload the zip ($5 one-time dev-account fee if not already paid). Use the
   district account.
3. **Visibility → Private**, restricted to the `orono.k12.mn.us` org, so it's
   not publicly discoverable.
4. Submit. Private items still get a review but it's fast.
5. For updates: bump `version` in `manifest.json`, re-zip, re-upload.

### Force-install via Google Admin console

**Admin console → Devices → Chrome → Apps & extensions → Users & browsers.**
Scope to the student OU, add the extension by ID
(`nmelakoijagkfanhilcnagkochhfmacn`), set **Force install** (auto-installs,
students can't disable). Optionally pin it to the toolbar there too.

### Pilot shortcut (no Web Store needed yet)

For one section before the real rollout, **Load unpacked** from
`extension/` on the pilot machines. With the `key` now in the manifest, the
unpacked ID is already `nmelakoijagkfanhilcnagkochhfmacn`, so once the OAuth
client's Application ID is updated (above), auth works locally with no further
setup.
