import type pg from 'pg';
import { snakeToCamel } from '../case.js';
import { findSyncTable, type SyncTable } from '../tables.js';
import { storedRow } from './sql.js';
import type { Batch } from './types.js';

// How deep a parent chain may go (results → runs → sessions).
const MAX_PARENT_DEPTH = 4;

// The project of a row: sent by the app, stored already, or copied from its parent (stored, or
// later in the same batch). null = a company-wide row; undefined = it cannot be placed.
export async function projectOf(
  client: pg.PoolClient,
  batch: Batch,
  table: SyncTable,
  id: string,
  fields: Record<string, unknown>,
  stored: Record<string, unknown> | undefined,
  depth = 0,
): Promise<string | null | undefined> {
  if (table.scope === 'projects') {
    return id;
  }
  if (table.scope !== 'project') {
    return null;
  }
  if (stored !== undefined) {
    return (stored.project_id as string | null) ?? null;
  }
  const unplaced = table.projectOptional ? null : undefined;
  if (table.parent === null) {
    const sent = fields.projectId;
    return typeof sent === 'string' ? sent.toLowerCase() : unplaced;
  }
  if (depth > MAX_PARENT_DEPTH) {
    return undefined;
  }
  const parentTable = findSyncTable(table.parent.table)!;
  const parentId = table.parent.column === 'id' ? id : fields[snakeToCamel(table.parent.column)];
  if (typeof parentId !== 'string') {
    return unplaced;
  }
  const parentStored = await storedRow(client, parentTable, parentId);
  if (parentStored !== undefined) {
    return (parentStored.project_id as string | null) ?? null;
  }
  const inBatch = batch.mutations.get(parentId);
  if (inBatch !== undefined && inBatch.table === parentTable.name) {
    return projectOf(client, batch, parentTable, parentId, inBatch.fields, undefined, depth + 1);
  }
  return unplaced;
}
