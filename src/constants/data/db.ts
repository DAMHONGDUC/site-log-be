// Every table and Postgres enum type name, as created by migrations/*.sql.

export const TABLE = {
  // Server-only
  members: 'members',
  projectMembers: 'project_members',
  invitations: 'invitations',
  memberEvents: 'member_events',
  uploads: 'uploads',
  devices: 'devices',
  syncCounter: 'sync_counter',
  // Synced
  projects: 'projects',
  locations: 'locations',
  sessions: 'sessions',
  captures: 'captures',
  issues: 'issues',
  issueCaptures: 'issue_captures',
  phrases: 'phrases',
  annotations: 'annotations',
  reportBranding: 'report_branding',
  planSheets: 'plan_sheets',
  checklistTemplates: 'checklist_templates',
  checklistTemplateItems: 'checklist_template_items',
  checklistRuns: 'checklist_runs',
  checklistResults: 'checklist_results',
} as const;

export const PG_ENUM = {
  memberRole: 'member_role',
  sessionState: 'session_state',
  uploadMode: 'upload_mode',
  uploadState: 'upload_state',
  verifyState: 'verify_state',
} as const;

// Column names the snake_case mapping cannot derive (it splits digits off: "sha_256").
export const COLUMN = {
  sha256: 'sha256',
  s3UploadId: 's3_upload_id',
} as const;

// Where the forward-only .sql migrations live, from the compiled src/ (or dist/) folder.
export const MIGRATIONS = { parentDir: '..', dir: 'migrations', extension: '.sql' } as const;

// Schema keys are camelCase; Drizzle writes them as snake_case columns.
export const DRIZZLE_CASING = 'snake_case';

// Set on every connection: timestamps are read and written in UTC.
export const PG_SESSION_OPTIONS = '-c TimeZone=UTC';

// Names a table gets when a query joins it more than once.
export const TABLE_ALIAS = {
  // member_events → members, for who acted and whom it was about.
  actor: 'actor',
  subject: 'subject',
  // uploads → uploads: the caller's own upload.
  mine: 'mine',
} as const;

// LIKE pattern for "any characters".
export const SQL_LIKE_ANY = '%';
