/** File / tab names + column orders. Touching these means a migration. */

const NAMES = {
  ROOT_FOLDER: 'OPS Research Tool',
  ROSTER_WORKBOOK: 'OPS Research Tool - Roster',
  PROJECTS_WORKBOOK: 'OPS Research Tool - Projects',
  BUNDLES_WORKBOOK: 'OPS Research Tool - Bundles',
  ARCHIVED_FOLDER: 'Archived',
  ARCHIVED_STUDENTS_FOLDER: 'Archived-students',
  GROUP_SHEET_PREFIX: '[grp] ',
};

const TABS = {
  ROSTER: 'Roster',          // legacy flat roster — preserved as backup + migration source (see Classes v2)
  STUDENTS: 'Students',      // Classes v2: identity, one row per person
  CLASSES: 'Classes',        // Classes v2: one row per class (teacher assigned once)
  ENROLLMENTS: 'Enrollments',// Classes v2: student↔class many-to-many join
  STAFF: 'Staff',
  PROJECTS: 'Projects',
  BUNDLES: 'Bundles',
  META: 'Meta',
  SOURCES: 'Sources',
  HIGHLIGHTS: 'Highlights',
  AUDIT: 'Audit',
  GROUP_MEMBERS: 'Members',
};

const HEADERS = {
  // Legacy flat roster (kept for backup + one-time migration into the v2 trio).
  ROSTER: ['ID', 'First', 'Last', 'Email', 'Class', 'Teacher', 'TeacherEmail'],

  // Classes v2 normalized trio. `Class` (name) stays the string key used by
  // Projects.memberClasses + Drive class folders — the Classes tab only adds
  // metadata. Enrollments is the student↔class many-to-many join.
  STUDENTS: ['ID', 'First', 'Last', 'Email'],
  CLASSES: ['Class', 'TeacherEmail', 'SchoolYear', 'Status'],
  ENROLLMENTS: ['Email', 'Class'],

  STAFF: ['Name', 'Email', 'Role'],

  PROJECTS: [
    'projectId', 'name', 'schoolYear', 'bundleId', 'memberClasses',
    'status', 'rootFolderId', 'createdBy', 'createdAt',
    // Appended (positional mapping preserved). JSON blob of optional teacher
    // requirements: minSources / minHighlightsPerSource / minDistinctCategories
    // / requireAnnotation. Empty cell on existing rows → parser defaults.
    'requirements',
  ],

  BUNDLES: [
    'bundleId', 'name', 'style',
    'label1', 'label2', 'label3', 'label4', 'label5',
    'color1', 'color2', 'color3', 'color4', 'color5',
    'createdBy', 'createdAt',
  ],

  META: ['studentName', 'studentEmail', 'class', 'teacher', 'projectId', 'groupId'],

  SOURCES: [
    'sourceId', 'projectId', 'normalizedUrl', 'rawUrl', 'accessDate',
    'scrapedTitle', 'scrapedSite', 'scrapedDate', 'scrapedAuthor',
    'sourceType', 'citationFields', 'primarySecondary',
    'annotation', 'annotationLastEdited',
    'createdByEmail', 'createdAt',
    // Appended (not inserted) so existing Sheets only mismatch on this one
    // trailing column — ensureHeaders_ is strict and never migrates. Holds a
    // JSON blob of the richer scrape (publication/publisher/volume/issue/
    // pages/inferred sourceType). See migrateAddScrapedExtra_.
    'scrapedExtra',
  ],

  HIGHLIGHTS: [
    'highlightId', 'sourceId', 'projectId',
    'primaryCategory', 'secondaryCategory',
    'highlightedText', 'note',
    'createdByEmail', 'createdAt',
  ],

  AUDIT: ['eventId', 'projectId', 'action', 'actor', 'at', 'detail'],

  GROUP_MEMBERS: ['email', 'firstName', 'lastName', 'joinedAt', 'leftAt'],
};

const ROLES = {
  TEACHER: 'teacher',
  ADMIN: 'admin',
};

const PROJECT_STATUS = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
};

// A class can be retired without deleting its history (its name still appears in
// archived projects' memberClasses). Active classes are the ones offered in the
// New Project wizard + teacher pickers.
const CLASS_STATUS = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
};

const SOURCE_TYPES = ['website', 'article', 'book', 'primary'];
const PRIMARY_SECONDARY = ['primary', 'secondary', 'unset'];
const CITATION_STYLES = ['mla', 'chicago', 'apa'];

const AUDIT_ACTIONS = {
  ARCHIVE: 'archive',
  UNARCHIVE: 'unarchive',
  ARCHIVE_YEAR: 'archive_year',
  GROUP_MERGE: 'group_merge',
  GROUP_MOVE: 'group_move',
  GROUP_DISBAND: 'group_disband',
  GROUP_DISBAND_GROUP: 'group_disband_group',
  GROUP_UNMERGE: 'group_unmerge',
};
