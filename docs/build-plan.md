# NHD Research Tool — Build Plan (v1)

> Internal repo name: **ops-research-tool** (broader scope — also serves the 8th
> grade capstone and future AP Research projects). Plan title kept as "NHD" to
> match the original v1 deliverable.

**A Scrible replacement for Orono Public Schools.** Internal Chrome extension + Google
Apps Script backend + Google Docs sidebar + teacher web console. Built entirely on
Google Workspace (Sheets/Drive/Docs) — no Firebase, no non-core services — so all
student data stays under the district's existing Workspace for Education agreement.

This document is the spec handoff for Claude Code. It is the product of an extended
design interview; the decisions below are settled, not open. Build in the phase order
given. Do not start a phase until the previous one is genuinely working and testable.

---

## 1. Context & Goal

Orono students currently use **Scrible** (scrible.com) for two projects a year:
~200 7th graders for National History Day (NHD), and ~200 8th graders for a capstone.
Scrible is being replaced because of an unreliable solo vendor, a buggy extension that
loses student work, painful group setup, and tedious year-end cleanup.

**v1 target:** fully replace Scrible for one real NHD cycle, piloted with a single
class section while Scrible runs in parallel as a safety net.

### What the tool does

1. A student researches on the web. They activate the extension; a toolbar appears.
2. They highlight text and assign it one of five **color-coded categories** mapped to
   NHD project phases. They can attach an optional note.
3. Saving a source captures its URL + scraped metadata. Highlights attach to sources.
4. In their Google Doc, a **sidebar** lets them filter highlights by category and by
   primary/secondary source, complete citations, and insert an annotated bibliography.
5. Teachers use a **web console** to create/manage/archive projects, form groups, and
   monitor student progress via a visual dashboard.

---

## 2. Settled Design Decisions

These came out of the design interview. Treat them as requirements.

### Identity & roster
- **No login.** Students are always signed into their district Google account via SSO
  (the Chrome profile is the school account even on personal devices). The backend
  identifies the student from `Session.getActiveUser().getEmail()` on each request.
- District emails are **opaque unique IDs**, not human-readable. Email is the join key;
  the student's real name must be stored separately (from the roster).
- A single **master roster Sheet**: columns `Name, Email, Class, Teacher`.
  - Email must be unique. `Class` strings must be exactly consistent (grouping keys
    off exact match). Validate on import.
  - The roster is the enrollment list — only emails on it get provisioned.
  - Roster is **replaced wholesale each school year**, not edited in place.
- A **Staff list** (second tab, same workbook): `Name, Email, Role` where `Role` is
  `teacher` or `admin`. This is purely an authorization gate for the Teacher Console.
  - `teacher` — sees only their own classes/projects.
  - `admin` — sees everything; can manage roster and do bulk actions.

### Data ownership
- All Sheets and folders live in a **district-owned Shared Drive**.
- **PoC exception:** during initial proof-of-concept the developer's personal account
  may own everything. Migration to the Shared Drive is a **hard gate** before any real
  student data lands (before the pilot section starts).
- To make that migration painless: put root folder ID, roster Sheet ID, and owner
  email in a **single config block** at the top of the Apps Script. No hardcoded IDs
  scattered through the code.
- Students never own their own Sheets — they interact via the extension and sidebar
  only. This is what makes one-click archiving possible.

### Projects
- The unit of work is a **Project** (e.g. "History Day 26-27"), a bounded container
  with its own folders, category bundle, school year, and member classes.
- Projects are created via the Teacher Console (the "wizard" is just the create flow
  inside the console — not a separate app).
- **Wizard fields, v1 — exactly these, nothing more:** project name, school year
  (dropdown), category bundle (dropdown), member classes/teachers. Clicking create
  writes a row to the Projects registry and creates the root folder.
- A project can contain **both solo students and groups** simultaneously (NHD allows
  students to choose).
- **Provisioning is automatic and lazy:** the first time a student saves a highlight,
  the backend looks them up in the roster and creates their Sheet (and any missing
  parent folders) on the spot. No teacher ever manually "sets up" anything.

### Category bundles
- A **bundle** is a reusable named set of up to 5 category label/color pairs.
- The History Day bundle (ships pre-built):
  1. Background  2. Build-Up  3. Main Event  4. Short-Term Impact  5. Long-Term Impact
- Teachers can **author new bundles** in the Console — a contained form: exactly 5
  label fields, 5 colors chosen from a fixed preset palette (~8 swatches, NOT a free
  color picker), a bundle name, save.
- Teachers **cannot edit existing bundles.** Bundles are immutable once created. A
  change means creating a new bundle (e.g. "Capstone v2"). Immutability is what makes
  it safe to let teachers create them freely.

### Highlighting (the most-repeated action — keep it frictionless)
- **Highlight-first workflow.** A student just starts highlighting; the first highlight
  on a page silently auto-creates the source record (URL + scraped metadata). No
  citation form at capture time.
- On-page interaction: select text → small popup with the 5 category swatches (labeled
  with the bundle's names) → click one → saved, popup closes. An optional "add note"
  affordance expands a text field; a note is never required.
- The selected text is **wrapped in a colored span and stays marked for the rest of
  the session on that page** (using the primary category's color). It disappears on
  reload — the data is safe server-side regardless. Highlights are **never**
  re-rendered on a return visit (re-anchoring is explicitly out of scope).
- Clicking an in-session mark **focuses that highlight's entry in the sidebar** if the
  sidebar is open; otherwise it's a no-op. The page mark is display-only — all editing,
  re-categorizing, and deleting happens in the sidebar.
- **One highlight = one primary category** (required, set on the page). This is the
  SOP. No multi-category at capture time — the act of choosing is the learning.
- An **optional secondary category** can be added per highlight, but **only in the
  sidebar**, never on the page popup. Zero or one secondary tag per highlight.

### Sources & citations
- A source is keyed by `project + normalized URL` (strip tracking params and fragments)
  so multiple highlights on one page attach to one source, not duplicates.
- Sources legitimately live in an **incomplete state** (saved, has highlights, no
  finished citation/classification/annotation). The sidebar and dashboard surface
  these as to-dos.
- **Metadata scrape:** best-effort, silent, at clip time. Grab `document.title`,
  `og:site_name`, `article:published_time`, author meta tags. Whatever is found
  pre-fills the citation form later; whatever is missing is just an empty field.
  Always store raw URL + access date (100% reliable). No readability libraries — keep
  it to standard meta tags; the student is the verification fallback.
- **Primary/secondary** is a property of the **source**, set in the citation form,
  with hard validation ("you must classify this source" before it counts as complete).
  Highlights inherit their source's primary/secondary status — not tagged independently.
- **Annotation:** one free-text field per source (the NHD 2-3 sentence annotation).
  Editable in the sidebar at any time (students typically write it after reading the
  source, not at clip time). Store a `lastEdited` timestamp on it for the dashboard.
- **Citation styles:** build the citation module as a **style dispatcher** —
  `formatCitation(fields, style)` — with `style` as a field on the bundle. The data
  model stores structured citation *fields*, never a pre-formatted string, so it is
  style-agnostic. **v1 ships MLA 9 only** (`formatMLA()`). Chicago and APA are planned
  drop-in functions added later when the capstone / AP Research projects are real and
  their rubrics are confirmed — no refactor required, just new functions.
- Constrain MLA to ~4 source types: website, news/magazine article, book, primary
  document. When writing a citation into the Doc, apply italics to the correct ranges.

### PDF handling
- A content script **cannot** inject the toolbar into Chrome's native PDF viewer.
- **v1 builds PDF Tier 2:** when a student saves a PDF, the extension fetches the file
  and runs **PDF.js** (`getTextContent()`) to extract the full text, then displays it
  in the extension's own panel — where the student can select passages and apply
  categories normally (it's now just text in your DOM).
- **Scanned/image PDFs** have no text layer; PDF.js extracts nothing. Detect this and
  show a clear message ("this PDF has no extractable text — save it as a source and
  take notes manually"). OCR is **out of scope** for v1.
- Tier 1 (save the PDF as a source with manual citation, copy the file to the project
  Drive folder) falls out for free as the fallback when extraction yields nothing.

### Offline buffer (this is what kills the Scrible "lost work" bug)
- Every highlight writes to `chrome.storage.local` **immediately and synchronously**,
  before any network call. The student feels "saved" instantly.
- A background service worker drains a **sync queue** to the Apps Script web app with
  retry/backoff. `chrome.storage.local` persists across browser restarts.
- The student is never blocked — they can keep highlighting indefinitely while offline
  or while the queue is backed up.
- A small, calm, persistent **sync status indicator** on the toolbar: "All saved"
  (green) / "3 saving…" (amber) / "Offline — saved on this device, will sync when
  reconnected" (reassuring text, NOT a scary red error).
- Backend writes are **idempotent** — upsert keyed on the highlight's unique ID, so a
  duplicated sync overwrites the same row instead of creating a second.
- **Known accepted limitation:** data created offline on a device that *never*
  reconnects is stranded in that device's local storage. The sync indicator makes this
  *visible* rather than silent. Not solvable without a real-time backend; accepted.

### Concurrency strategy (also no Firebase)
- **One Sheet per student** (or per group), in per-class folders under the project
  root. 200 students each writing to their own file ≈ zero write contention. This also
  makes archiving trivial — archiving a class/project is moving/flagging a folder, not
  deleting students one by one.
- Apps Script web apps cap concurrent executions (~30 consumer / higher for Workspace).
  Fine here because buffered writes mean brief queueing is invisible to the student.

### Groups
- Everyone starts as an **individual** (one provisioning path — lazy, per-student).
- "Group" is a **separate merge action** layered on top, done by the teacher in the
  Console: select 2-4 students → "merge into group" → backend creates a group Sheet,
  **migrates** those students' existing highlights/sources into it, and re-points their
  extensions to the group Sheet.
- The wizard has **no group step** — groups are formed whenever, after project creation
  (teachers often don't know final groups at creation time).
- Merge does **not auto-dedupe** duplicate sources — it combines all rows; duplicate
  cleanup is manual in the sidebar (auto-merging means deciding whose annotation/flag
  wins — a rabbit hole; keep merge dumb and reliable).
- Support **un-merge / move a student between groups** — model group membership as a
  changeable list, not a baked-in fact. Lower priority than merge itself.
- 3-5 students writing to one group Sheet ≈ trivial contention.
- Every highlight still stores the **email of the student who made it**, so the
  dashboard shows individual contribution within a group (grading fairness).

### The active-project selector
- A student can be in **multiple concurrent projects** (e.g. NHD *and* an ELA research
  paper). The system cannot silently infer the active project.
- The extension shows a **persistent, always-visible** "current project" indicator:
  `Saving to: History Day 26-27 ▾`. The student sets it once; it is **sticky**
  (persisted in `chrome.storage.local`, survives restarts) until they deliberately
  change it.
- The dropdown lists only that student's open projects (roster ∩ open projects).
- The Docs sidebar reads the **same** stored active-project value, so extension and
  sidebar stay in sync.
- First use, or if the stored project is archived/invalid, it prompts for a choice.

### The Docs sidebar (the writing phase)
- Shows the student's highlights for the active project, filterable by **category**
  and by **primary/secondary**. Cross-filtering both at once is supported and is the
  point (e.g. "Background highlights from primary sources").
- Filtering matches **primary OR secondary** category — a highlight surfaces under
  either of its tags.
- Lets the student complete/edit the **citation form** (pre-filled from the scrape)
  and edit **annotations** at any time. Re-categorize and delete highlights here.
- The sidebar is a **thinking and reference surface**, not a transfer surface. There
  is exactly **one** insertion button: **Insert Bibliography** — writes the annotated
  bibliography into the Doc as two alphabetized sections ("Primary Sources" /
  "Secondary Sources"), each entry as citation followed by an indented annotation,
  with correct italics.
- There is **no "insert highlight" or "insert as quote" button.** Sidebar text is
  selectable (a student can manually copy a legitimate quote), but no button-driven
  transfer of source text exists. This is deliberate — it aligns with the district's
  cognitive-autonomy posture; the friction is a feature.

### Teacher Console (one GAS web app, Staff-list gated, role-aware sections)
- **My Projects** — list with create / open / archive. Teachers see their own;
  archived projects move to an "Archived" section.
- **Create Project** — the wizard (name, school year, bundle, classes).
- **Project Dashboard** — see below.
- **Bundles** — pick existing, or author new (5 labels, 5 preset swatches, name, save).
- **Admin area** (visible to `admin` role only) — roster management, and a bulk
  **"archive school year"** action: flips every project with a matching `schoolYear`
  to archived in one click. Confirmation-gated (lists affected projects). Reversible.
- The whole console must carry **OPS brand styling** (see the `ops-brand-guidelines`
  skill) — it is a district-facing tool and should not look like raw Apps Script.

### Teacher dashboard (inside a project)
- **All-students table is the dashboard — visual and scannable at a glance.** A
  teacher with 100+ students scans for trouble; color and shape scan, numbers don't.
  Each row:
  - A **tiny 5-segment stacked category bar** showing the student's highlight mix
    across the five phases, in the bundle's category colors.
  - **Color-coded status chips** for gaps (sources missing citation / classification /
    annotation): green = clear, amber = a few, red = many.
  - A small **progress indicator** (bar or ring) for overall completion.
  - Name + a couple of headline totals as text.
  - The table reads like a heat map of the class. Every row must be **identical in
    shape** (fixed-width mini-bar, fixed chip set) so the grid stays clean with 100+
    rows — performance and visual clarity both matter.
- **Drill-down (click a student)** — precise numbers and larger charts:
  - Highlights-by-category **bar chart** (the star — shows research balance against
    the NHD rubric), colored with the bundle's category colors.
  - Primary vs. secondary source counts.
  - Completion breakdown (complete vs. missing citation/classification/annotation).
  - Highlights/sources **over time** line chart.
  - The student's sources with their highlights (grouped by category) and annotations.
- The dashboard is **read-only.** Teachers do not edit student data. Teacher *actions*
  are project-level (create, archive, group); student data is fixed by the student in
  their sidebar.
- Dashboard category stats count **primary category only** (secondary tags affect
  sidebar filtering, never dashboard stats; counting them would double-count).
- **Deferred past v1:** teacher goal-setting, analytics beyond the above, source
  credibility scoring, data export.

### Lifecycle
- Projects are the lifecycle unit. Year-end "cleanup" = archiving last year's projects.
  There is **no per-student year-end work** — the Scrible pain point structurally
  doesn't exist here.
- **Archive** flips the project status to `archived`: it drops off the default project
  list, the extension stops offering it as a selectable project, the dashboard stays
  openable read-only, and the data is **retained, never deleted**. Optionally moves the
  project folder under an "Archived" parent. Archive is **reversible** (just a flag).
- **No hard-delete in v1.** Actual data purging is a deliberate manual admin action,
  never automated, never tied to Google account offboarding.
- A departed student's data stays put — it's rows in a Shared-Drive-owned Sheet; the
  dead email becomes an inert key but the data and name remain for the teacher.

---

## 3. Data Model

All data lives in Google Sheets in the Shared Drive. Folder layout:

```
[Project Root Folder]  (one per project)
├── Roster + Staff workbook  (master — may live above project root; one for the district)
├── Projects registry Sheet
├── Bundles config Sheet
├── [Class A folder]
│   ├── [student-email] Sheet
│   ├── [student-email] Sheet
│   └── [group-id] Sheet
└── [Class B folder]
    └── ...
```

### Projects registry (one Sheet, all projects)
`projectId, name, schoolYear, bundleId, memberClasses, status (active|archived), rootFolderId, createdBy, createdAt`

### Bundles config (one Sheet)
`bundleId, name, style (mla|chicago|apa), label1..label5, color1..color5, createdBy, createdAt`

(Immutable rows. v1 ships one row: the History Day bundle, style = `mla`.)

### Per-student / per-group Sheet — tabs:

**`Meta`** — `studentName, studentEmail, class, teacher, projectId, groupId (nullable)`

**`Sources`** —
`sourceId, projectId, normalizedUrl, rawUrl, accessDate, scrapedTitle, scrapedSite,
scrapedDate, scrapedAuthor, sourceType (website|article|book|primary), citationFields
(structured), primarySecondary (primary|secondary|unset), annotation,
annotationLastEdited, createdByEmail, createdAt`

**`Highlights`** —
`highlightId, sourceId, projectId, primaryCategory, secondaryCategory (nullable),
highlightedText, note (nullable), createdByEmail, createdAt`

### Roster workbook
- Tab `Roster`: `Name, Email, Class, Teacher`
- Tab `Staff`: `Name, Email, Role (teacher|admin)`

> Source IDs and highlight IDs are UUIDs generated client-side (in the extension) so
> writes are idempotent and offline-safe.

---

## 4. Architecture

```
┌─────────────────┐   instant    ┌──────────────────┐   sync queue   ┌─────────────────┐
│ Chrome Extension│ ───────────▶ │ chrome.storage   │ ─────────────▶ │ Apps Script     │
│ (Manifest V3)   │   write      │ .local (buffer)  │  retry/backoff │ Web App (doPost)│
│ - toolbar       │              └──────────────────┘                │ - find-or-create│
│ - 5-color marks │                                                  │ - idempotent    │
│ - PDF.js panel  │                                                  │   upsert         │
│ - project sel.  │                                                  └────────┬────────┘
│ - sync indicator│                                                           │
└─────────────────┘                                                           ▼
                                                              ┌──────────────────────────┐
┌─────────────────┐                                           │ Google Sheets            │
│ Docs Sidebar    │ ◀──────── doGet ────────────────────────▶ │ (Shared Drive)           │
│ (GAS add-on)    │                                           │ per-student/group Sheets │
└─────────────────┘                                           │ + registries             │
                                                              └──────────────────────────┘
┌─────────────────┐                                                           ▲
│ Teacher Console │ ◀──────── doGet / doPost ─────────────────────────────────┘
│ (GAS web app)   │
└─────────────────┘
```

- **Extension:** Manifest V3, vanilla JS or light React. Content script injects the
  toolbar; background service worker runs the sync queue. PDF.js bundled in.
- **Backend:** Apps Script web app. `doPost` for writes, `doGet` for reads. Find-or-
  create logic for Sheets/folders. Identity from `Session.getActiveUser().getEmail()`.
- **Sidebar:** Apps Script editor add-on (`showSidebar()`), reads/writes via the same
  backend functions.
- **Console:** Apps Script web app, HTML service, OPS-branded.
- Note: Apps Script web apps can be finicky with CORS from an extension — handle with
  proper host permissions and the background service worker.

---

## 5. Build Phases

Build in this order. **Do not start a phase until the previous one genuinely works and
is testable.** The whole agreed feature set is in v1 — the phasing is what keeps it
shippable: if time runs short, each completed phase still leaves a usable tool.

### Phase 1 — Backend, schema, roster, provisioning
- Config block (root folder ID, roster Sheet ID, owner email) at top of the script.
- Build the Sheet schema exactly as Section 3. Hand-build one sample per-student Sheet
  to develop against.
- Roster + Staff workbook; import + validation (unique emails, consistent `Class`).
- Projects registry and Bundles config Sheets; seed the History Day bundle.
- `doPost` endpoint: accept a batch of highlights/sources, identify the student, find-
  or-create their Sheet by email (lazy provisioning, incl. parent folders), idempotent
  upsert keyed on highlight/source IDs.
- `doGet` endpoints for the sidebar and console (added/extended in later phases).
- **Testable deliverable:** POST JSON via curl/Postman and watch rows land in the
  correct auto-created Sheet.

### Phase 2 — Chrome extension
- Manifest V3 scaffold; content script + background service worker.
- Toolbar UI: 5 category swatches (from the active bundle), optional note field.
- On-page session marks (colored spans, primary color, vanish on reload).
- Click-a-mark → focus in sidebar (message passing; no-op if sidebar closed).
- Highlight-first source auto-creation; metadata scrape; URL normalization.
- Persistent sticky **project selector**; sync **status indicator**.
- **Offline buffer:** synchronous write to `chrome.storage.local`, background sync
  queue with retry/backoff, idempotent.
- **PDF Tier 2:** detect PDF URLs, fetch + PDF.js text extraction, own text panel for
  selecting/categorizing; scanned-PDF detection + message; Tier 1 fallback.
- **Testable deliverable:** highlight on real web pages and PDFs; data survives going
  offline, logging out, and closing the browser; lands correctly via Phase 1.

### Phase 3 — Google Docs sidebar
- Editor add-on; reads the active project (same stored value as the extension).
- Highlight list, filter by category + primary/secondary (match primary OR secondary).
- Citation form (pre-filled from scrape), MLA via `formatCitation(fields,'mla')`;
  hard primary/secondary validation.
- Annotation editing with `lastEdited` tracking.
- Re-categorize / delete highlights; add the optional **secondary tag** here.
- **Insert Bibliography** — two alphabetized sections, citation + indented annotation,
  correct italics. (The only insertion button.)
- **Testable deliverable:** a student can filter research, complete citations, and
  insert a correct annotated bibliography into a Doc.

### Phase 4 — Teacher Console + pilot
- One GAS web app, OPS-branded, Staff-list gated, role-aware.
- My Projects (list/create/open/archive); Create Project wizard (name, school year,
  bundle, classes).
- Bundles: pick existing / author new (5 labels, 5 preset swatches, name).
- Project Dashboard: visual scannable all-students table (mini category bars, status
  chips, progress) + drill-down (charts, precise numbers, sources/highlights view).
  Read-only.
- Group **merge** (create group Sheet, migrate work, re-point extensions); un-merge.
- Admin area: roster management; bulk **archive school year** (confirmation-gated,
  reversible).
- **Shared Drive migration** (hard gate — see Risk Register) before real data lands.
- **Pilot:** force-install the extension to a test group; run **one section** of
  Shogren's NHD against Scrible-as-safety-net; fix what breaks; then go wide.
- **Testable deliverable:** a real class section completes an NHD research cycle on
  the tool.

---

## 6. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | **Solo-developer dependency** — the district depends on one part-time builder; the tool dies if he's unavailable. This is the exact failure mode being escaped from Scrible. | High | High | Keep code clean and documented. Migrate to Shared Drive + service account early. Treat the pilot, not a full rollout, as v1's bar. Long-term: get a second person familiar with the codebase. |
| 2 | **Shipping under deadline pressure** — full scope + side-project time risks an unfinished build as Scrible's clock runs out. | High | High | Buy the one stopgap year of Scrible (already decided). Strict phase order so every completed phase is independently usable. Pilot one section, not all 200. |
| 3 | **Personal account owns student data** during PoC → offboarding or account loss risks the data. | Med | High | **Hard gate:** migrate to district Shared Drive before the pilot section starts. Config block makes the migration a 5-minute change. |
| 4 | **Scanned/image PDFs** yield no extractable text; students confused. | High | Low | Detect missing text layer; show a clear message; fall back to Tier 1 (save as source, manual notes). OCR explicitly out of scope. |
| 5 | **Highlight re-anchoring expectations** — students or teachers expect highlights to reappear on revisited pages. | Med | Med | Out of scope by design. The sidebar filtered to a source gives the same information reliably. Set expectations in training. |
| 6 | **Data stranded on a never-reconnecting device.** | Low | Med | Sync status indicator makes unsynced work visible. Accepted limitation; document it. |
| 7 | **Apps Script quotas / concurrency** under burst load (~200 students). | Low | Med | Per-student Sheets eliminate write contention; buffered writes absorb execution-slot queueing. Workspace accounts have higher limits. Validate during the pilot. |
| 8 | **Citation correctness** — a misplaced comma is visible and undermines trust. | Med | Med | v1 MLA only, constrained to ~4 source types. Verify `formatMLA()` against real NHD examples. Students verify/complete citations themselves (a research skill). |
| 9 | **Extension force-install policy** blocks deployment. | Low | High | Confirmed feasible — a department colleague already force-installs extensions via the Admin console. |
| 10 | **Group merge data loss/duplication.** | Low | Med | Merge migrates all rows (no data loss); no auto-dedupe (no ambiguous overwrites); duplicates cleaned manually. Test merge thoroughly in Phase 4. |
| 11 | **Roster data quality** — duplicate/blank emails or inconsistent `Class` strings misroute data or break grouping. | Med | Med | Validate on import. Export cleanly from SIS/Classroom. Replace the roster wholesale yearly rather than hand-editing. |
| 12 | **Scope creep** — more citation styles, more wizard fields, bundle-editing, etc. | Med | Med | Architecture already absorbs future styles as drop-in functions. Hold the v1 line: MLA only, 4-field wizard, immutable bundles. Defer, don't redesign. |

---

## 7. Open Items to Confirm Before / During Build

1. **Shared Drive** — confirm one can be provisioned (admin action) before the pilot.
2. **Roster export** — confirm clean `Name, Email, Class, Teacher` export from the SIS
   or Google Classroom.
3. **Pilot agreement** — confirm Shogren will run one section on the tool in parallel
   with Scrible for one cycle.
4. **Database articles** — ask Shogren what fraction of NHD sources are subscription-
   database articles vs. regular web pages vs. PDFs. HTML database articles work with
   the normal toolbar once the student is authenticated; PDF ones fold into Tier 2.
   The answer reshapes nothing structural but sets expectations.
5. **`product-self-knowledge` / Manifest V3 specifics** — verify current Chrome
   extension policy details and the self-hosted vs. unlisted force-install path with
   the Admin console owner.

---

*End of plan. Build Phase 1 first.*
