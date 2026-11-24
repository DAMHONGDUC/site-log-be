import { is } from 'drizzle-orm';
import { toSnakeCase } from 'drizzle-orm/casing';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/data/schema/index.js';
import { syncTables } from '../../src/modules/sync/tables.js';
import { testDatabaseUrl } from '../helpers/global-setup.js';

// Migrations are the source of truth; the Drizzle schema must describe exactly what they built.

const MIGRATION_LEDGER = 'schema_migrations';

interface DbColumn {
  table_name: string;
  column_name: string;
  is_nullable: 'YES' | 'NO';
}

const drizzleTables = Object.values(schema).filter((value) => is(value, PgTable));

// "table.column:nullable" for every column, so a mismatch names the column.
function drizzleColumns(): string[] {
  return drizzleTables.flatMap((table) => {
    const config = getTableConfig(table);

    return config.columns.map((column) => {
      const name = column.keyAsName ? toSnakeCase(column.name) : column.name;

      return `${config.name}.${name}:${column.notNull ? 'NO' : 'YES'}`;
    });
  });
}

describe('Drizzle schema', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: testDatabaseUrl });
  });
  afterAll(async () => {
    await pool.end();
  });

  it('matches every table and column the migrations created', async () => {
    const result = await pool.query<DbColumn>(
      `select table_name, column_name, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name <> $1`,
      [MIGRATION_LEDGER],
    );
    const database = result.rows.map(
      (row) => `${row.table_name}.${row.column_name}:${row.is_nullable}`,
    );

    expect(drizzleColumns().sort()).toEqual(database.sort());
  });

  it('has a table for every synced table, and only those', () => {
    expect(Object.keys(schema.SYNCED_TABLES).sort()).toEqual(
      syncTables.map((table) => table.name).sort(),
    );
  });
});
