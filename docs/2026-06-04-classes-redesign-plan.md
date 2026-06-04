# Classes redesign — design & implementation plan

**Status:** Tracks A–F implemented + the admin Classes UI, on branch
`feat/classes-redesign` (pushed to GAS HEAD, not yet merged). Pure logic
Node-tested green; migration verified on the live roster; `devTest*` await an
editor run. Supersedes the build-plan's flat one-class-per-student roster.

## 1. Goal

- A **student can be in multiple classes**.
- A **class can be in multiple projects**, and a **project can span multiple
  classes** (this already works via `Projects.memberClasses`).
- A **teacher can own multiple classes**, each used in multiple projects.
- **Class becomes a first-class entity** (created, named, teacher assigned once).
- Snappy reads; OPS brand-aligned admin UI; schema verified to run correctly.

## 2. Why this is NOT a storage rewrite (the key finding)

Per-student work is stored **one Sheet per `(student, project)`** — the
`SheetManifest` key is `projectId|emailLower` (no class), and the solo Sheet's
filename is `"<project> — Research — <email>"` (email is the lookup key, class is
**not** in it). The `Class` only drives: (a) which **class folder** the Sheet is
filed under, (b) **dashboard grouping**, (c) **project eligibility**.

`Projects.memberClasses` is already a CSV → a many-to-many **project↔class** join.

So the only genuinely missing relation is **student↔class many-to-many**. We add
that + a Class entity, and make per-`(student,project)` Sheet lookup
**class-agnostic** (manifest/email-first, never keyed on the student's "one
class"). No change to how a student's work is stored.

## 3. Schema (in the Roster workbook)

Replace the single `Roster` tab with a normalized trio (legacy `Roster` tab is
**kept untouched as backup + migration source**):

| Tab | Headers | Notes |
| --- | --- | --- |
| `Students` | `ID, First, Last, Email` | one row per person; `Email` is the key |
| `Classes` | `Class, TeacherEmail, SchoolYear, Status` | one row per class; **one teacher per class** (kills drift); `Class` name stays the string key used by `Projects.memberClasses` + Drive folders |
| `Enrollments` | `Email, Class` | the new many-to-many join |
| `Staff` | `Name, Email, Role` | unchanged |

`Class` stays a **string key** everywhere (projects, folders, groups) → no ripple
into projects/Drive/groups. `Classes` only adds metadata keyed by that name.

## 4. Migration (self-healing, once, reversible)

`ensureClassSchema_()` (called at the top of every roster read, cheap after the
first time):
1. If `Students` tab is absent → create `Students`/`Classes`/`Enrollments`.
2. If a legacy `Roster` tab has rows AND a ScriptProperty `OPS_CLASS_SCHEMA_V2`
   is unset → backfill the trio from it via the **pure** transform
   `buildClassSchemaFromLegacy_(legacyRows)`:
   - `Students` = distinct `Email` → `{ID,First,Last,Email}`
   - `Classes` = distinct `Class` → `{Class, TeacherEmail (from its rows),
     SchoolYear:'', Status:'active'}`
   - `Enrollments` = each legacy row → `{Email, Class}`
   - set `OPS_CLASS_SCHEMA_V2='done'`.
3. Legacy `Roster` tab is never deleted (rollback = clear the property + drop the
   trio). Migration is idempotent (guarded by the property + tab presence).

## 5. Data-access layer — `40_roster_model.js` (new)

Pure (Node-tested) + thin I/O. Replaces scattered `getStudentRosterEntry_` use.

- **Pure:** `buildClassSchemaFromLegacy_(rows)`, `studentEligibleProjects_(studentClasses, projects)`, `intersect_(a,b)`, `dedupeBy_`.
- **I/O reads (one batched read per request, memo-cached):**
  `getStudentIdentity_(email)→{ID,First,Last,Email}|null`,
  `getStudentClasses_(email)→[Class,...]`,
  `getStudentRosterEntry_(email)` (compat shim → `{Name,Email,classes:[],Class:classes[0]||''}`),
  `listClasses_()→[{Class,TeacherEmail,SchoolYear,Status}]`,
  `getClassRecord_(name)`, `classTeacher_(name)`, `enrollmentsForClass_(name)→[email]`,
  `listClassesTaughtBy_(email)` (now from `Classes.TeacherEmail`),
  `studentsInClasses_(classNames)→[identity]` (dashboard enrolled, deduped by email).
- **I/O writes:** `createClass_`, `updateClass_`, `deleteClass_`, `enroll_`,
  `unenroll_`, `setStudentClasses_`, `upsertStudent_`, `deleteStudent_`,
  `replaceRoster_` (import → rebuild trio).

## 6. Multi-class Sheet resolution (the one storage-touch)

Make solo-Sheet lookup **class-agnostic**:
- `findOrCreateSoloSheet_` / `getSoloSheetIfExists_` resolve by **manifest first**
  (`projectId|email`), then fall back to walking **all** class folders in the
  project for the email (not just the student's "first" class).
- On **create**, file under the deterministic class = first of
  `sort(studentClasses ∩ project.memberClasses)` (stable). `Meta.class` becomes
  informational only.
- Result: a multi-class student has exactly one Sheet per project regardless of
  how many of their classes the project covers. Groups stay per-class (a student
  may be in one group per class — already supported by folder=class).

## 7. File-by-file changes — parallel tracks

Tracks are file-isolated where possible (per Paul's plan-parallelism preference).

- **Track A — schema + model + migration** (`02_constants.js`, new
  `40_roster_model.js`, `10_identity.js`): the foundation. Everything else
  depends on it. *Do first.*
- **Track B — eligibility + provisioning** (`12_projects.js`,
  `11_provisioning.js`, `21_reads.js`, `15_sheet_manifest.js`): multi-class
  project list + class-agnostic Sheet lookup.
- **Track C — console + dashboard + archive** (`61_console_api.js`,
  `63_admin_api.js`, `65_lifecycle.js`): `listClassesTaughtBy_` from `Classes`,
  `dashboardEnrolled_` via enrollments, `consoleGetStudentDetail` auth via
  enrollments, new `admin*Class*` + `adminListClasses` endpoints, roster
  reads/writes through the model.
- **Track D — sample data** (`67_sample_data.js`): seed via the model
  (students + enrollments + a sample class).
- **Track E — admin "Classes" UI** (`console_js.html`, `admin_js.html`,
  `console_css.html`): menu `Classes / Staff / Archive`; Classes screen (list,
  create, assign teacher from Staff, manage enrolled students, import). Brand
  tokens already in `console_css.html` (OPS blue `--c-brand-primary #2d3f89`,
  Lexend display). Use `anthropic-skills:ops-brand-guidelines`.
- **Track F — extension/sidebar** (`53_sidebar_api.js`, `30_endpoints.js`):
  `getStudentRosterEntry_` shim already returns `classes[]`; project list already
  goes through `listActiveProjectsForStudent_` (now multi-class). Mostly free.

Groups (`66_groups.js`) need **no schema change** — per-class invariant holds; a
multi-class student can be in one group per class.

## 8. Testing

- **Node pure tests** (`apps-script/test/*.node.js`, run locally via `vm`):
  `buildClassSchemaFromLegacy_` (dedup students/classes, enrollments fidelity,
  teacher-per-class), `studentEligibleProjects_` (intersection), canonicalize,
  dedupe.
- **`devTest*`** (pushed): `devTestClassSchemaMigration` (build trio from a DEV
  fixture, assert tabs + round-trip, clean up), `devTestMultiClassEnrollment`
  (enroll one student in 2 classes → sees both classes' projects → one Sheet per
  project), `devTestClassTeacherScope`, updated `devTestAdminRosterCrud/Replace`.
- **Live verify:** read the Roster workbook via Drive MCP before/after to confirm
  the trio is built correctly.

## 9. Performance

Roster is small (hundreds of rows). One batched read of the trio per request,
memoized within the request. Dashboard's heavy per-student parallel CSV reads are
unchanged. Class→teacher and student→classes become O(1) map lookups after a
single read. No new per-student Drive walks (manifest still short-circuits).

## 10. Backward compatibility

- Legacy `Roster` tab preserved; migration is one-time + guarded + reversible.
- `Class` stays a string key → projects, Drive folders, groups, `memberClasses`
  untouched.
- `getStudentRosterEntry_` shim keeps existing callers working (`.Class` =
  first class) while new callers use `.classes[]`.
