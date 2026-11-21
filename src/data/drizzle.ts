import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import * as schema from './schema/index.js';
import { DRIZZLE_CASING } from '../constants/data/db.js';

export type SqlDb = NodePgDatabase<typeof schema>;

// Repositories query through Drizzle on whatever connection they get: the pool, or the one client
// of a transaction. Schema keys are camelCase; `casing` writes them as snake_case columns.
export function toDrizzle(client: pg.Pool | pg.PoolClient): SqlDb {
  return drizzle({ client, schema, casing: DRIZZLE_CASING });
}
