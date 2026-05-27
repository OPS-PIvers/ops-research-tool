/** File / tab names + column orders. Touching these means a migration. */

const NAMES = {
  ROOT_FOLDER: 'OPS Research Tool',
  ROSTER_WORKBOOK: 'OPS Research Tool - Roster',
  PROJECTS_WORKBOOK: 'OPS Research Tool - Projects',
  BUNDLES_WORKBOOK: 'OPS Research Tool - Bundles',
  ARCHIVED_FOLDER: 'Archived',
};

const TABS = {
  ROSTER: 'Roster',
  STAFF: 'Staff',
  PROJECTS: 'Projects',
  BUNDLES: 'Bundles',
  META: 'Meta',
  SOURCES: 'Sources',
  HIGHLIGHTS: 'Highlights',
  AUDIT: 'Audit',
};

const HEADERS = {
  ROSTER: ['ID', 'First', 'Last', 'Email', 'Class', 'Teacher', 'TeacherEmail'],
  STAFF: ['Name', 'Email', 'Role'],

  PROJECTS: [
    'projectId', 'name', 'schoolYear', 'bundleId', 'memberClasses',
    'status', 'rootFolderId', 'createdBy', 'createdAt',
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
  ],

  HIGHLIGHTS: [
    'highlightId', 'sourceId', 'projectId',
    'primaryCategory', 'secondaryCategory',
    'highlightedText', 'note',
    'createdByEmail', 'createdAt',
  ],

  AUDIT: ['eventId', 'projectId', 'action', 'actor', 'at', 'detail'],
};

const ROLES = {
  TEACHER: 'teacher',
  ADMIN: 'admin',
};

const PROJECT_STATUS = {
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
};
