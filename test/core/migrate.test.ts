import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/migrate.js';
import { testDatabaseUrl } from '../helpers/global-setup.js';

describe('runMigrations', () => {
  let pool: pg.Pool;
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: testDatabaseUrl });
  });
  afterAll(async () => {
    await pool.query('drop table if exists migrate_test_a, migrate_test_b');
    await pool.query(`delete from schema_migrations where name like 'test_%'`);
    await pool.end();
  });

  it('runs each file once, in order, and stops at a broken one', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'migrations-'));
    await writeFile(path.join(dir, 'test_0001_a.sql'), 'create table migrate_test_a (id int);');
    await writeFile(path.join(dir, 'test_0002_b.sql'), 'create table migrate_test_b (id int);');

    expect(await runMigrations(pool, dir)).toEqual(['test_0001_a.sql', 'test_0002_b.sql']);
    expect(await runMigrations(pool, dir)).toEqual([]);

    await writeFile(path.join(dir, 'test_0003_broken.sql'), 'create tabel oops;');
    await expect(runMigrations(pool, dir)).rejects.toThrow('test_0003_broken.sql');
    const done = await pool.query(
      `select name from schema_migrations where name = 'test_0003_broken.sql'`,
    );
    expect(done.rows).toHaveLength(0);
  });
});
