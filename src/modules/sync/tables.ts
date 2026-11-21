import { TABLE } from '../../constants/data/db.js';
import { ACTION, type Action } from '../../constants/domain/roles.js';
import { SYNC_COLUMN, SYNC_SCOPE, type SyncScope } from '../../constants/data/sync.js';

// Every table the app may pull and push. A feature that adds a synced table adds it here.

// F19: who may see a row.
// - project: rows of one project (project_id), seen by the members who reach it
// - projects: the projects table itself (its id is the project)
// - company: one set for the whole company (report branding)
// - personal: the caller's own rows (phrases keep uid)
export type { SyncScope } from '../../constants/data/sync.js';

export interface SyncTable {
  // SQL table name, also the `table` value in a mutation.
  name: string;
  // Business columns (snake_case) the app sends on every upsert, as a full row.
  columns: string[];
  // Kept from the first insert; later values are ignored (evidence must not change).
  immutable: string[];
  // Enum columns that only move forward, whatever the timestamps say.
  monotonic: string[];
  // A second unique key besides id (uid is always part of it). A new row that collides
  // with a live row on it loses: the app adopts the stored row. null = no such key.
  naturalKey: string[] | null;
  scope: SyncScope;
  // project_id is not sent by the app: the server copies it from this parent row.
  parent: { table: string; column: string } | null;
  // project_id may be null: a row for every project (built-in checklist templates).
  projectOptional: boolean;
  // The permission an upsert and a delete need (05-team-and-roles §3).
  writeAction: Action;
  deleteAction: Action;
}

interface TableOptions {
  immutable?: string[];
  monotonic?: string[];
  naturalKey?: string[] | null;
  scope?: SyncScope;
  parent?: { table: string; column: string } | null;
  projectOptional?: boolean;
  write: Action;
  delete?: Action;
}

function table(name: string, columns: string[], options: TableOptions): SyncTable {
  const immutable = options.immutable ?? [];
  // A row never moves to another project.
  if (columns.includes(SYNC_COLUMN.projectId) && !immutable.includes(SYNC_COLUMN.projectId)) {
    immutable.push(SYNC_COLUMN.projectId);
  }
  return {
    name,
    columns,
    immutable,
    monotonic: options.monotonic ?? [],
    naturalKey: options.naturalKey ?? null,
    scope: options.scope ?? SYNC_SCOPE.project,
    parent: options.parent ?? null,
    projectOptional: options.projectOptional ?? false,
    writeAction: options.write,
    deleteAction: options.delete ?? options.write,
  };
}

export const syncTables: SyncTable[] = [
  // F03
  table(TABLE.projects, ['name', 'address', 'client_name', 'created_at'], {
    immutable: ['created_at'],
    scope: SYNC_SCOPE.projects,
    write: ACTION.projectEdit,
    delete: ACTION.projectDelete,
  }),
  table(TABLE.locations, ['project_id', 'parent_id', 'code', 'kind', 'sort_index'], {
    immutable: ['project_id'],
    write: ACTION.locationEdit,
  }),
  table(
    TABLE.sessions,
    ['project_id', 'started_at', 'ended_at', 'surveyor_name', 'note', 'state'],
    {
      immutable: ['project_id', 'started_at'],
      monotonic: ['state'],
      write: ACTION.sessionWrite,
    },
  ),
  // F05: evidence columns never change after the first insert.
  table(
    TABLE.captures,
    [
      'project_id',
      'session_id',
      'location_id',
      'kind',
      'sha256',
      'byte_size',
      'captured_at',
      'time_confidence',
      'latitude',
      'longitude',
      'horizontal_accuracy',
      'device_model',
      'duration_seconds',
      'device_reading',
      'remote_key',
      'verification_code',
      'excluded_from_report',
    ],
    {
      immutable: [
        'project_id',
        'session_id',
        'kind',
        'sha256',
        'byte_size',
        'captured_at',
        'time_confidence',
        'latitude',
        'longitude',
        'horizontal_accuracy',
        'device_model',
        'duration_seconds',
        'device_reading',
      ],
      write: ACTION.captureWrite,
      delete: ACTION.captureDelete,
    },
  ),
  // F08
  table(
    TABLE.issues,
    [
      'project_id',
      'location_id',
      'title',
      'detail',
      'severity',
      'status',
      'due_date',
      'assignee_name',
      'assignee_uid',
      'trade',
      'plan_sheet_id',
      'pin_x',
      'pin_y',
      'resolved_by_issue_id',
      'source_checklist_result_id',
    ],
    { write: ACTION.issueWrite, delete: ACTION.issueDelete },
  ),
  table(TABLE.issueCaptures, ['issue_id', 'capture_id'], {
    immutable: ['issue_id', 'capture_id'],
    naturalKey: ['issue_id', 'capture_id'],
    parent: { table: TABLE.issues, column: 'issue_id' },
    write: ACTION.issueWrite,
  }),
  table(TABLE.phrases, ['text', 'usage_count'], {
    immutable: ['text'],
    naturalKey: ['text'],
    scope: SYNC_SCOPE.personal,
    write: ACTION.phraseWrite,
  }),
  // F09: the markup of a capture shares the capture's id.
  table(TABLE.annotations, ['shapes'], {
    parent: { table: TABLE.captures, column: 'id' },
    write: ACTION.markupWrite,
  }),
  // F10, F19: one live row for the whole company, so the natural key is empty.
  table(
    TABLE.reportBranding,
    ['company_name', 'logo_key', 'accent_hex', 'client_block', 'footer_text'],
    {
      naturalKey: [],
      scope: SYNC_SCOPE.company,
      write: ACTION.brandingEdit,
    },
  ),
  // F11
  table(
    TABLE.planSheets,
    [
      'project_id',
      'location_id',
      'name',
      'page_index',
      'pixel_width',
      'pixel_height',
      'sha256',
      'remote_key',
    ],
    { immutable: ['project_id', 'sha256', 'pixel_width', 'pixel_height'], write: ACTION.planEdit },
  ),
  // F12
  table(
    TABLE.checklistTemplates,
    ['project_id', 'name', 'applies_to', 'is_built_in', 'usage_count'],
    {
      projectOptional: true,
      write: ACTION.templateEdit,
    },
  ),
  table(
    TABLE.checklistTemplateItems,
    ['template_id', 'ordinal', 'text', 'default_severity', 'requires_photo_on_fail'],
    {
      parent: { table: TABLE.checklistTemplates, column: 'template_id' },
      projectOptional: true,
      write: ACTION.templateEdit,
    },
  ),
  table(
    TABLE.checklistRuns,
    ['template_id', 'session_id', 'location_id', 'started_at', 'completed_at'],
    {
      immutable: ['template_id', 'session_id', 'location_id', 'started_at'],
      parent: { table: TABLE.sessions, column: 'session_id' },
      write: ACTION.checklistRun,
    },
  ),
  table(
    TABLE.checklistResults,
    ['run_id', 'template_item_id', 'outcome', 'note', 'issue_id', 'answered_at'],
    {
      immutable: ['run_id', 'template_item_id'],
      naturalKey: ['run_id', 'template_item_id'],
      parent: { table: TABLE.checklistRuns, column: 'run_id' },
      write: ACTION.checklistRun,
    },
  ),
];

export function findSyncTable(name: string): SyncTable | undefined {
  return syncTables.find((candidate) => candidate.name === name);
}
