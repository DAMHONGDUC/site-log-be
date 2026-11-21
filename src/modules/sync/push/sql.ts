import type pg from 'pg';
import type { SyncTable } from '../tables.js';

// Postgres error codes: 23505 unique, 23503 foreign key, 22xxx bad value, 23xxx other rules.
export const PG = {
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  badValueClass: '22',
  ruleClass: '23',
} as const;

export function pgCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String(error.code);
  }
  return '';
}

export function isPrimaryKeyViolation(error: unknown): boolean {
  const constraint = (error as { constraint?: string }).constraint ?? '';
  return constraint.endsWith('_pkey');
}

// The owner column: phrases are personal (uid), every other row keeps who made it.
export function ownerColumn(table: SyncTable): string {
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
  const owner = table.scope === 'personal' ? 't.uid = excluded.uid and ' : '';
  return `insert into ${table.name} as t (${columnList})
select ${selectList} from jsonb_populate_record(null::${table.name}, $1::jsonb) as r
on conflict (id) do update set ${sets.join(', ')}
where ${owner}t.deleted_at is null and (${changed})
returning *`;
}

// A delete wins a tie with an edit made at the same instant.
export function deleteSql(table: SyncTable): string {
  const owner = table.scope === 'personal' ? ' and uid = $2' : ' and $2::text is not null';
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
  if (table.scope === 'personal') {
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

// The company rev counter (one row, locked by the batch).
export async function lockCounter(client: pg.PoolClient): Promise<void> {
  await client.query('select last_rev from sync_counter for update');
}

export async function nextRev(client: pg.PoolClient): Promise<number> {
  const result = await client.query<{ last_rev: number }>(
    'update sync_counter set last_rev = last_rev + 1 returning last_rev',
  );
  return Number(result.rows[0]!.last_rev);
}

export async function currentRev(db: pg.Pool | pg.PoolClient): Promise<number> {
  const result = await db.query<{ last_rev: number }>('select last_rev from sync_counter');
  return Number(result.rows[0]?.last_rev ?? 0);
}

export async function purgedThroughRev(db: pg.Pool): Promise<number> {
  const result = await db.query<{ purged_through_rev: number }>(
    'select purged_through_rev from sync_counter',
  );
  return Number(result.rows[0]?.purged_through_rev ?? 0);
}
