import type { Action } from '../constants/roles.js';

// Every table the app may pull and push. A feature that adds a synced table adds it here.

// F19: who may see a row.
// - project: rows of one project (project_id), seen by the members who reach it
// - projects: the projects table itself (its id is the project)
// - company: one set for the whole company (report branding)
// - personal: the caller's own rows (phrases keep uid)
export type SyncScope = 'project' | 'projects' | 'company' | 'personal';

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
  if (columns.includes('project_id') && !immutable.includes('project_id')) {
    immutable.push('project_id');
  }
  return {
    name,
    columns,
    immutable,
    monotonic: options.monotonic ?? [],
    naturalKey: options.naturalKey ?? null,
    scope: options.scope ?? 'project',
    parent: options.parent ?? null,
    projectOptional: options.projectOptional ?? false,
    writeAction: options.write,
    deleteAction: options.delete ?? options.write,
  };
}

export const syncTables: SyncTable[] = [
  // F03
  table('projects', ['name', 'address', 'client_name', 'created_at'], {
    immutable: ['created_at'],
    scope: 'projects',
    write: 'project.edit',
    delete: 'project.delete',
  }),
  table('locations', ['project_id', 'parent_id', 'code', 'kind', 'sort_index'], {
    immutable: ['project_id'],
    write: 'location.edit',
  }),
  table('sessions', ['project_id', 'started_at', 'ended_at', 'surveyor_name', 'note', 'state'], {
    immutable: ['project_id', 'started_at'],
    monotonic: ['state'],
    write: 'session.write',
  }),
  // F05: evidence columns never change after the first insert.
  table(
    'captures',
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
      write: 'capture.write',
      delete: 'capture.delete',
    },
  ),
  // F08
  table(
    'issues',
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
    { write: 'issue.write', delete: 'issue.delete' },
  ),
  table('issue_captures', ['issue_id', 'capture_id'], {
    immutable: ['issue_id', 'capture_id'],
    naturalKey: ['issue_id', 'capture_id'],
    parent: { table: 'issues', column: 'issue_id' },
    write: 'issue.write',
  }),
  table('phrases', ['text', 'usage_count'], {
    immutable: ['text'],
    naturalKey: ['text'],
    scope: 'personal',
    write: 'phrase.write',
  }),
  // F09: the markup of a capture shares the capture's id.
  table('annotations', ['shapes'], {
    parent: { table: 'captures', column: 'id' },
    write: 'markup.write',
  }),
  // F10, F19: one live row for the whole company, so the natural key is empty.
  table(
    'report_branding',
    ['company_name', 'logo_key', 'accent_hex', 'client_block', 'footer_text'],
    {
      naturalKey: [],
      scope: 'company',
      write: 'branding.edit',
    },
  ),
  // F11
  table(
    'plan_sheets',
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
    { immutable: ['project_id', 'sha256', 'pixel_width', 'pixel_height'], write: 'plan.edit' },
  ),
  // F12
  table('checklist_templates', ['project_id', 'name', 'applies_to', 'is_built_in', 'usage_count'], {
    projectOptional: true,
    write: 'template.edit',
  }),
  table(
    'checklist_template_items',
    ['template_id', 'ordinal', 'text', 'default_severity', 'requires_photo_on_fail'],
    {
      parent: { table: 'checklist_templates', column: 'template_id' },
      projectOptional: true,
      write: 'template.edit',
    },
  ),
  table(
    'checklist_runs',
    ['template_id', 'session_id', 'location_id', 'started_at', 'completed_at'],
    {
      immutable: ['template_id', 'session_id', 'location_id', 'started_at'],
      parent: { table: 'sessions', column: 'session_id' },
      write: 'checklist.run',
    },
  ),
  table(
    'checklist_results',
    ['run_id', 'template_item_id', 'outcome', 'note', 'issue_id', 'answered_at'],
    {
      immutable: ['run_id', 'template_item_id'],
      naturalKey: ['run_id', 'template_item_id'],
      parent: { table: 'checklist_runs', column: 'run_id' },
      write: 'checklist.run',
    },
  ),
];

export function findSyncTable(name: string): SyncTable | undefined {
  return syncTables.find((candidate) => candidate.name === name);
}
