import pg from 'pg';
import { runMigrations } from '../src/migrate.js';

// Before all tests: a fresh, migrated sitelog_test database next to the dev database.
export const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://sitelog:sitelog@localhost:5432/sitelog_test';

export default async function setup(): Promise<void> {
  const url = new URL(testDatabaseUrl);
  const databaseName = url.pathname.slice(1);
  const adminUrl = new URL(testDatabaseUrl);
  adminUrl.pathname = '/postgres';

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`drop database if exists ${databaseName} with (force)`);
  await admin.query(`create database ${databaseName}`);
  await admin.end();

  const pool = new pg.Pool({ connectionString: testDatabaseUrl });
  await runMigrations(pool);
  await pool.end();
}
