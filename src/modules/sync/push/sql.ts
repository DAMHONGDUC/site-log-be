import type pg from 'pg';
import type { SyncTable } from '../tables.js';
import { PG_ERROR } from '../../../constants/platform/external.js';
import { SYNC_COLUMN, SYNC_SCOPE } from '../../../constants/data/sync.js';

export { PG_ERROR as PG } from '../../../constants/platform/external.js';

// One savepoint of a push: open it, keep it, or undo back to it.
export const savepointSql = {
  open: (name: string) => `savepoint ${name}`,
  release: (name: string) => `release savepoint ${name}`,
  rollback: (name: string) => `rollback to savepoint ${name}`,
} as const;

export function pgCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String(error.code);
  }

  return '';
}

export function isPrimaryKeyViolation(error: unknown): boolean {
  const constraint = (error as { constraint?: string }).constraint ?? '';

  return constraint.endsWith(PG_ERROR.primaryKeySuffix);
}

// The owner column: phrases are personal (uid), every other row keeps who made it.
export function ownerColumn(table: SyncTable): string {
  return table.scope === SYNC_SCOPE.personal ? SYNC_COLUMN.uid : SYNC_COLUMN.createdBy;
}

function syncColumns(table: SyncTable): string[] {
  const columns: string[] = [
    SYNC_COLUMN.id,
    ownerColumn(table),
    SYNC_COLUMN.rev,
    SYNC_COLUMN.clientUpdatedAt,
    SYNC_COLUMN.deletedAt,
  ];

  if (table.parent !== null) {
    // Copied from the parent row by the server.
    columns.push(SYNC_COLUMN.projectId);
  }

  return columns;
}

// insert … on conflict (id) do update: last write wins on client_updated_at, decided in SQL.
export function upsertSql(table: SyncTable): string {
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
  // Permissions were checked before; here: a tombstone never comes back, only a newer write wins,
  // and personal rows still match their owner.
  const owner = table.scope === SYNC_SCOPE.personal ? 't.uid = excluded.uid and ' : '';

  return `insert into ${table.name} as t (${columnList})
select ${selectList} from jsonb_populate_record(null::${table.name}, $1::jsonb) as r
on conflict (id) do update set ${sets.join(', ')}
where ${owner}t.deleted_at is null and (${changed})
returning *`;
}

// A delete wins a tie with an edit made at the same instant.
export function deleteSql(table: SyncTable): string {
  const owner = table.scope === SYNC_SCOPE.personal ? ' and uid = $2' : ' and $2::text is not null';

  return `update ${table.name}
set deleted_at = $3, client_updated_at = $3, rev = $4
where id = $1${owner} and deleted_at is null and client_updated_at <= $3
returning *`;
}

export async function storedRow(
  client: pg.PoolClient,
  table: SyncTable,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  const result = await client.query(`select * from ${table.name} where id = $1`, [id]);

  return result.rows[0];
}

// The live row that already owns this natural key (for example the same phrase text).
export async function rowWithSameNaturalKey(
  client: pg.PoolClient,
  table: SyncTable,
  uid: string,
  record: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const conditions = ['deleted_at is null'];
  const values: unknown[] = [];

  if (table.scope === SYNC_SCOPE.personal) {
    values.push(uid);
    conditions.push(`uid = $${values.length}`);
  }
  for (const column of table.naturalKey ?? []) {
    values.push(record[column]);
    conditions.push(`${column} = $${values.length}`);
  }
  const result = await client.query(
    `select * from ${table.name} where ${conditions.join(' and ')} limit 1`,
    values,
  );

  return result.rows[0];
}
