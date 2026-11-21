import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { Config } from '../core/config.js';
import { PG_TYPE_ID } from '../constants/runtime/units.js';

// bigint (type 20) comes back as a JS number: sizes and revs stay far below 2^53.
pg.types.setTypeParser(PG_TYPE_ID.int8, (text) => Number(text));
// date (type 1082) stays a plain "2026-11-05" string instead of a local-midnight Date.
pg.types.setTypeParser(PG_TYPE_ID.date, (text) => text);

// Shared by the pool and by the realtime hub's own LISTEN connection.
export function connectionOptions(config: Config): pg.ClientConfig {
  let ssl: pg.PoolConfig['ssl'] = undefined;
  if (config.databaseSslCaPath !== undefined) {
    // AWS RDS: verify the server certificate against the RDS CA bundle.
    const ca = readFileSync(config.databaseSslCaPath, 'utf8');
    ssl = { ca, rejectUnauthorized: true };
  }
  return {
    connectionString: config.databaseUrl,
    ssl,
    // Every timestamp is read and written in UTC.
    options: '-c TimeZone=UTC',
  };
}

export function createPool(config: Config): pg.Pool {
  const options = connectionOptions(config);
  return new pg.Pool({ ...options, max: config.pgPoolMax });
}

// Runs `work` inside one transaction: commit on success, rollback on any error.
export async function withTransaction<T>(
  pool: pg.Pool,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // The connection itself failed: throw it away instead of returning it to the pool.
      broken = true;
    }
    throw error;
  } finally {
    client.release(broken);
  }
}
