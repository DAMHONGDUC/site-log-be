import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createLogger } from './logger.js';

// Forward-only migrations: every file in migrations/ runs once, in file-name order,
// each in its own transaction. A file that already ran is never edited, only followed.

const here = path.dirname(fileURLToPath(import.meta.url));
export const defaultMigrationsDir = path.resolve(here, '..', 'migrations');

// Any number works; it only has to be the same for every process running migrations.
const MIGRATION_LOCK_ID = 7_241_001;

export async function runMigrations(
  pool: pg.Pool,
  dir: string = defaultMigrationsDir,
): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    // Two deploys at once must not run the same file twice.
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(
      `create table if not exists schema_migrations (
         name text primary key,
         run_at timestamptz not null default now()
       )`,
    );
    const done = await client.query<{ name: string }>('select name from schema_migrations');
    const doneNames = new Set(done.rows.map((row) => row.name));

    const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      if (doneNames.has(file)) {
        continue;
      }
      const sql = await readFile(path.join(dir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        applied.push(file);
      } catch (error) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    client.release();
  }
  return applied;
}

// `npm run migrate` locally, `node dist/migrate.js` on the server.
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const pool = createPool(config);
  try {
    const applied = await runMigrations(pool);
    logger.info({ applied }, 'migrations done');
  } catch (error) {
    logger.error({ err: error }, 'migrations failed');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  await main();
}
