import { byName } from './by-name.js';

// Values of the sync protocol (02-sync, 01-api §6) and the columns every synced row carries.

export const MUTATION_OPS = ['upsert', 'delete'] as const;
export const MUTATION_OP = byName(MUTATION_OPS);
export type MutationOp = (typeof MUTATION_OPS)[number];

export const MUTATION_STATUSES = ['applied', 'superseded', 'rejected'] as const;
export const MUTATION_STATUS = byName(MUTATION_STATUSES);

// F19: who may see a row (see SyncTable.scope).
export const SYNC_SCOPES = ['project', 'projects', 'company', 'personal'] as const;
export const SYNC_SCOPE = byName(SYNC_SCOPES);
export type SyncScope = (typeof SYNC_SCOPES)[number];

export const SYNC_COLUMN = {
  id: 'id',
  uid: 'uid',
  createdBy: 'created_by',
  rev: 'rev',
  clientUpdatedAt: 'client_updated_at',
  deletedAt: 'deleted_at',
  projectId: 'project_id',
  serverCreatedAt: 'server_created_at',
} as const;

// JSON keys are camelCase, SQL columns snake_case: words are joined with this.
export const SNAKE_SEPARATOR = '_';

// Savepoints of one push: a mutation, and the insert inside it.
export const SAVEPOINT = { mutation: 'mutation', upsert: 'upsert' } as const;
