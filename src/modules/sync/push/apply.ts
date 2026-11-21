import type pg from 'pg';
import { RejectReason } from '../../../constants/http/error-codes.js';
import { createRepositories, type Repositories } from '../../../data/repositories.js';
import { camelToSnake, rowToJson } from '../case.js';
import { findSyncTable, type SyncTable } from '../tables.js';
import { permissionProblem } from './authorization.js';
import { projectOf } from './placement.js';
import {
  PG,
  deleteSql,
  isPrimaryKeyViolation,
  ownerColumn,
  pgCode,
  rowWithSameNaturalKey,
  storedRow,
  upsertSql,
} from './sql.js';
import {
  Batch,
  type Mutation,
  type MutationResult,
  type PushContext,
  type PushOutcome,
} from './types.js';

// The row an upsert writes, or the reason it cannot be written.
function recordFor(
  table: SyncTable,
  mutation: Mutation,
  uid: string,
  rev: number,
  projectId: string | null,
): Record<string, unknown> | string {
  const record: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(mutation.fields)) {
    const column = camelToSnake(field);
    if (!table.columns.includes(column)) {
      return RejectReason.unknownField(field);
    }
    record[column] = value;
  }
  record.id = mutation.id;
  record[ownerColumn(table)] = uid;
  record.rev = rev;
  record.client_updated_at = mutation.clientUpdatedAt;
  record.deleted_at = null;
  if (table.parent !== null) {
    record.project_id = projectId;
  }
  return record;
}

async function applyUpsert(
  client: pg.PoolClient,
  batch: Batch,
  table: SyncTable,
  mutation: Mutation,
  rev: number,
  stored: Record<string, unknown> | undefined,
  projectId: string | null,
): Promise<MutationResult> {
  const uid = batch.context.member.uid;
  const record = recordFor(table, mutation, uid, rev, projectId);
  if (typeof record === 'string') {
    return { id: mutation.id, status: 'rejected', reason: record };
  }

  // A failed statement poisons the transaction, so the insert gets its own savepoint:
  // after a unique violation we still need to read the row that won.
  await client.query('savepoint upsert');
  try {
    const written = await client.query(upsertSql(table), [JSON.stringify(record)]);
    await client.query('release savepoint upsert');
    if (written.rows.length > 0) {
      if (table.name === 'issues') {
        batch.issueChanges.push({
          issueId: mutation.id,
          projectId: projectId!,
          before: stored,
          after: written.rows[0],
        });
      }
      return { id: mutation.id, status: 'applied' };
    }
  } catch (error) {
    await client.query('rollback to savepoint upsert');
    if (
      pgCode(error) === PG.uniqueViolation &&
      table.naturalKey !== null &&
      !isPrimaryKeyViolation(error)
    ) {
      const owner = await rowWithSameNaturalKey(client, table, uid, record);
      if (owner !== undefined) {
        return { id: mutation.id, status: 'superseded', serverRow: rowToJson(owner) };
      }
    }
    throw error;
  }

  // Nothing written: a newer write, or a tombstone.
  const after = await storedRow(client, table, mutation.id);
  if (after === undefined || (table.scope === 'personal' && after.uid !== uid)) {
    return { id: mutation.id, status: 'rejected', reason: RejectReason.forbidden };
  }
  return { id: mutation.id, status: 'superseded', serverRow: rowToJson(after) };
}

async function applyDelete(
  client: pg.PoolClient,
  batch: Batch,
  table: SyncTable,
  mutation: Mutation,
  rev: number,
): Promise<MutationResult> {
  const written = await client.query(deleteSql(table), [
    mutation.id,
    batch.context.member.uid,
    mutation.clientUpdatedAt,
    rev,
  ]);
  if (written.rows.length > 0) {
    return { id: mutation.id, status: 'applied' };
  }
  const stored = await storedRow(client, table, mutation.id);
  if (stored === undefined || stored.deleted_at !== null) {
    // Never reached the server, or already deleted: nothing left to do.
    return { id: mutation.id, status: 'applied' };
  }
  return { id: mutation.id, status: 'superseded', serverRow: rowToJson(stored) };
}

// One mutation inside a savepoint: a bad or refused row is rejected without losing the batch.
async function applyMutation(
  client: pg.PoolClient,
  repos: Repositories,
  batch: Batch,
  mutation: Mutation,
): Promise<MutationResult> {
  const table = findSyncTable(mutation.table);
  if (table === undefined) {
    return { id: mutation.id, status: 'rejected', reason: RejectReason.unknownTable };
  }
  await client.query('savepoint mutation');
  try {
    const stored = await storedRow(client, table, mutation.id);
    const projectId = await projectOf(client, batch, table, mutation.id, mutation.fields, stored);
    let result: MutationResult;
    if (projectId === undefined) {
      result = { id: mutation.id, status: 'rejected', reason: RejectReason.missingParent };
    } else {
      const problem = await permissionProblem(client, batch, table, mutation, stored, projectId);
      if (problem !== null) {
        result = { id: mutation.id, status: 'rejected', reason: problem };
      } else {
        const rev = await repos.syncState.nextRev();
        result =
          mutation.op === 'delete'
            ? await applyDelete(client, batch, table, mutation, rev)
            : await applyUpsert(client, batch, table, mutation, rev, stored, projectId);
      }
    }
    await client.query('release savepoint mutation');
    return result;
  } catch (error) {
    await client.query('rollback to savepoint mutation');
    const code = pgCode(error);
    if (code.startsWith(PG.badValueClass) || code.startsWith(PG.ruleClass)) {
      return { id: mutation.id, status: 'rejected', reason: RejectReason.invalidRow(code) };
    }
    throw error;
  }
}

export async function applyBatch(
  client: pg.PoolClient,
  context: PushContext,
  mutations: Mutation[],
): Promise<PushOutcome> {
  const repos = createRepositories(client);
  await repos.syncState.lockCounter();
  const reach = await context.access.reach(context.member, repos);
  const batch = new Batch(context, reach, mutations);
  const results: MutationResult[] = [];
  for (const mutation of mutations) {
    results.push(await applyMutation(client, repos, batch, mutation));
  }
  return {
    results,
    serverRev: await repos.syncState.currentRev(),
    issueChanges: batch.issueChanges,
  };
}
