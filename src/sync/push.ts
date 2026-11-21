import type pg from 'pg';
import { withTransaction } from '../db.js';
import { reachable, reaches, type Member, type Reach } from '../team/access.js';
import { can, type Action } from '../team/permissions.js';
import { camelToSnake, rowToJson } from './case.js';
import { findSyncTable, type SyncTable } from './tables.js';

export interface Mutation {
  table: string;
  id: string;
  op: 'upsert' | 'delete';
  clientUpdatedAt: string;
  fields: Record<string, unknown>;
}

export type MutationResult =
  | { id: string; status: 'applied' }
  | { id: string; status: 'superseded'; serverRow: Record<string, unknown> }
  | { id: string; status: 'rejected'; reason: string };

// A change other members may need to hear about (sent as a push after commit).
export interface IssueChange {
  issueId: string;
  projectId: string;
  before: Record<string, unknown> | undefined;
  after: Record<string, unknown>;
}

export interface PushResult {
  results: MutationResult[];
  serverRev: number;
}

export interface PushOutcome extends PushResult {
  issueChanges: IssueChange[];
}

export interface PushContext {
  member: Member;
  siteTimeZone: string;
}

// The owner column: phrases are personal (uid), every other row keeps who made it.
function ownerColumn(table: SyncTable): string {
  return table.scope === 'personal' ? 'uid' : 'created_by';
}

function syncColumns(table: SyncTable): string[] {
  const columns = ['id', ownerColumn(table), 'rev', 'client_updated_at', 'deleted_at'];
  if (table.parent !== null) {
    // Copied from the parent row by the server.
    columns.push('project_id');
  }
  return columns;
}

// insert … on conflict (id) do update: last write wins on client_updated_at, decided in SQL.
function upsertSql(table: SyncTable): string {
  const allColumns = [...syncColumns(table), ...table.columns];
  const columnList = allColumns.join(', ');
  const selectList = allColumns.map((column) => `r.${column}`).join(', ');
  const newer = 't.client_updated_at < excluded.client_updated_at';

  const sets: string[] = [];
  for (const column of table.columns) {
    if (table.immutable.includes(column)) {
      continue;
    }
    if (table.monotonic.includes(column)) {
      // Enums compare in declaration order: draft < active < closed < exported.
      sets.push(`${column} = greatest(t.${column}, excluded.${column})`);
    } else {
      sets.push(`${column} = case when ${newer} then excluded.${column} else t.${column} end`);
    }
  }
  sets.push('client_updated_at = greatest(t.client_updated_at, excluded.client_updated_at)');
  sets.push('rev = excluded.rev');

  let changed = newer;
  for (const column of table.monotonic) {
    changed += ` or excluded.${column} > t.${column}`;
  }

  // jsonb_populate_record lets Postgres turn JSON values into the column types (and reject bad ones).
  // Permissions were checked before; here: a tombstone never comes back, and only a newer write wins.
  // Personal rows are still matched on their owner.
  const owner = table.scope === 'personal' ? 't.uid = excluded.uid and ' : '';
  return `insert into ${table.name} as t (${columnList})
select ${selectList} from jsonb_populate_record(null::${table.name}, $1::jsonb) as r
on conflict (id) do update set ${sets.join(', ')}
where ${owner}t.deleted_at is null and (${changed})
returning *`;
}

function deleteSql(table: SyncTable): string {
  // A delete wins a tie with an edit made at the same instant.
  const owner = table.scope === 'personal' ? ' and uid = $2' : ' and $2::text is not null';
  return `update ${table.name}
set deleted_at = $3, client_updated_at = $3, rev = $4
where id = $1${owner} and deleted_at is null and client_updated_at <= $3
returning *`;
}

async function storedRow(
  client: pg.PoolClient,
  table: SyncTable,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  const result = await client.query(`select * from ${table.name} where id = $1`, [id]);
  return result.rows[0];
}

// The live row that already owns this natural key (for example the same phrase text).
async function rowWithSameNaturalKey(
  client: pg.PoolClient,
  table: SyncTable,
  uid: string,
  record: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const naturalKey = table.naturalKey ?? [];
  const conditions = ['deleted_at is null'];
  const values: unknown[] = [];
  if (table.scope === 'personal') {
    values.push(uid);
    conditions.push(`uid = $${values.length}`);
  }
  for (const column of naturalKey) {
    values.push(record[column]);
    conditions.push(`${column} = $${values.length}`);
  }
  const result = await client.query(
    `select * from ${table.name} where ${conditions.join(' and ')} limit 1`,
    values,
  );
  return result.rows[0];
}

// Postgres error codes: 23505 unique, 23503 foreign key, 22xxx bad value, 23xxx other rules.
function pgCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String(error.code);
  }
  return '';
}

function isPrimaryKeyViolation(error: unknown): boolean {
  const constraint = (error as { constraint?: string }).constraint ?? '';
  return constraint.endsWith('_pkey');
}

async function nextRev(client: pg.PoolClient): Promise<number> {
  const result = await client.query<{ last_rev: string }>(
    'update sync_counter set last_rev = last_rev + 1 returning last_rev',
  );
  return Number(result.rows[0]!.last_rev);
}

// Everything one batch needs to place rows in projects and check permissions.
class Batch {
  readonly mutations = new Map<string, Mutation>();
  readonly issueChanges: IssueChange[] = [];
  constructor(
    readonly context: PushContext,
    readonly reach: Reach,
    mutations: Mutation[],
  ) {
    for (const mutation of mutations) {
      this.mutations.set(mutation.id, mutation);
    }
  }
}

// The project of a row: sent by the app, stored already, or copied from its parent
// (which may be stored or come later in the same batch). undefined = cannot be placed.
async function projectOf(
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
  if (table.parent === null) {
    const sent = fields.projectId;
    if (typeof sent === 'string') {
      return sent.toLowerCase();
    }
    return table.projectOptional ? null : undefined;
  }
  if (depth > 4) {
    return undefined;
  }
  const parentTable = findSyncTable(table.parent.table)!;
  const parentId =
    table.parent.column === 'id' ? id : (fields[snakeToCamelField(table.parent.column)] as unknown);
  if (typeof parentId !== 'string') {
    return table.projectOptional ? null : undefined;
  }
  const parentStored = await storedRow(client, parentTable, parentId);
  if (parentStored !== undefined) {
    return (parentStored.project_id as string | null) ?? null;
  }
  const inBatch = batch.mutations.get(parentId);
  if (inBatch !== undefined && inBatch.table === parentTable.name) {
    return projectOf(client, batch, parentTable, parentId, inBatch.fields, undefined, depth + 1);
  }
  return table.projectOptional ? null : undefined;
}

function snakeToCamelField(column: string): string {
  return column.replace(/_([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}

// Created by the caller, today in the site time zone (Inspectors may delete those).
async function ownSameDay(
  client: pg.PoolClient,
  table: SyncTable,
  stored: Record<string, unknown>,
  context: PushContext,
): Promise<boolean> {
  if (stored.created_by !== context.member.uid || !('server_created_at' in stored)) {
    return false;
  }
  const result = await client.query<{ same: boolean }>(
    `select (($1::timestamptz at time zone $2)::date = (now() at time zone $2)::date) as same`,
    [stored.server_created_at, context.siteTimeZone],
  );
  return result.rows[0]?.same === true;
}

// null = allowed; otherwise the rejection reason.
async function permissionProblem(
  client: pg.PoolClient,
  batch: Batch,
  table: SyncTable,
  mutation: Mutation,
  stored: Record<string, unknown> | undefined,
  projectId: string | null,
): Promise<string | null> {
  const { member } = batch.context;
  let action: Action;
  if (mutation.op === 'delete') {
    action = table.deleteAction;
  } else if (table.scope === 'projects' && stored === undefined) {
    action = 'project.create';
  } else {
    action = table.writeAction;
  }
  if (table.scope === 'personal') {
    if (stored !== undefined && stored.uid !== member.uid) {
      return 'forbidden';
    }
  } else if (
    !(table.scope === 'projects' && stored === undefined) &&
    !reaches(batch.reach, projectId)
  ) {
    return `forbidden:${action}`;
  }
  let own = false;
  if (mutation.op === 'delete' && stored !== undefined) {
    own = await ownSameDay(client, table, stored, batch.context);
  }
  if (!can(member.role, action, { ownSameDay: own })) {
    return `forbidden:${action}`;
  }
  return null;
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
  const record: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(mutation.fields)) {
    const column = camelToSnake(field);
    if (!table.columns.includes(column)) {
      return { id: mutation.id, status: 'rejected', reason: `unknown_field:${field}` };
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
    if (pgCode(error) === '23505' && table.naturalKey !== null && !isPrimaryKeyViolation(error)) {
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
    return { id: mutation.id, status: 'rejected', reason: 'forbidden' };
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
  const uid = batch.context.member.uid;
  const written = await client.query(deleteSql(table), [
    mutation.id,
    uid,
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
  batch: Batch,
  mutation: Mutation,
): Promise<MutationResult> {
  const table = findSyncTable(mutation.table);
  if (table === undefined) {
    return { id: mutation.id, status: 'rejected', reason: 'unknown_table' };
  }
  await client.query('savepoint mutation');
  try {
    const stored = await storedRow(client, table, mutation.id);
    const projectId = await projectOf(client, batch, table, mutation.id, mutation.fields, stored);
    if (projectId === undefined) {
      await client.query('release savepoint mutation');
      return { id: mutation.id, status: 'rejected', reason: 'missing_parent' };
    }
    const problem = await permissionProblem(client, batch, table, mutation, stored, projectId);
    if (problem !== null) {
      await client.query('release savepoint mutation');
      return { id: mutation.id, status: 'rejected', reason: problem };
    }
    const rev = await nextRev(client);
    let result: MutationResult;
    if (mutation.op === 'delete') {
      result = await applyDelete(client, batch, table, mutation, rev);
    } else {
      result = await applyUpsert(client, batch, table, mutation, rev, stored, projectId);
    }
    await client.query('release savepoint mutation');
    return result;
  } catch (error) {
    await client.query('rollback to savepoint mutation');
    const code = pgCode(error);
    if (code.startsWith('22') || code.startsWith('23')) {
      return { id: mutation.id, status: 'rejected', reason: `invalid_row:${code}` };
    }
    throw error;
  }
}

async function applyBatch(
  client: pg.PoolClient,
  context: PushContext,
  mutations: Mutation[],
): Promise<PushOutcome> {
  // The row lock: every other push in the company waits here, so revs commit in order.
  await client.query('select last_rev from sync_counter for update');
  const reach = await reachable(client, context.member);
  const batch = new Batch(context, reach, mutations);

  const results: MutationResult[] = [];
  for (const mutation of mutations) {
    results.push(await applyMutation(client, batch, mutation));
  }
  const state = await client.query<{ last_rev: string }>('select last_rev from sync_counter');
  return {
    results,
    serverRev: Number(state.rows[0]!.last_rev),
    issueChanges: batch.issueChanges,
  };
}

function isForeignKeyViolation(error: unknown): boolean {
  return pgCode(error) === '23503';
}

// Fast path: the whole batch in one transaction. Foreign keys are checked at commit; if one
// fails we cannot tell which row, so the slow path retries one mutation per transaction.
export async function pushMutations(
  pool: pg.Pool,
  context: PushContext,
  mutations: Mutation[],
): Promise<PushOutcome> {
  try {
    return await withTransaction(pool, (client) => applyBatch(client, context, mutations));
  } catch (error) {
    if (!isForeignKeyViolation(error)) {
      throw error;
    }
  }

  const results: MutationResult[] = [];
  const issueChanges: IssueChange[] = [];
  let serverRev = 0;
  for (const mutation of mutations) {
    try {
      const single = await withTransaction(pool, (client) =>
        applyBatch(client, context, [mutation]),
      );
      results.push(single.results[0]!);
      issueChanges.push(...single.issueChanges);
      serverRev = single.serverRev;
    } catch (error) {
      if (!isForeignKeyViolation(error)) {
        throw error;
      }
      results.push({ id: mutation.id, status: 'rejected', reason: 'missing_parent' });
    }
  }
  const state = await pool.query<{ last_rev: string }>('select last_rev from sync_counter');
  serverRev = Number(state.rows[0]?.last_rev ?? serverRev);
  return { results, serverRev, issueChanges };
}
