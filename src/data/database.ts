import type pg from 'pg';
import { withTransaction } from '../db.js';
import { createRepositories, type Repositories } from '../repositories/index.js';

// Anything that runs SQL: the pool, or one client inside a transaction.
export type Queryable = pg.Pool | pg.PoolClient;

// The one entry to the data layer: repositories on the pool, or on one transaction.
export class Database {
  readonly repos: Repositories;

  constructor(readonly pool: pg.Pool) {
    this.repos = createRepositories(pool);
  }

  // Liveness: throws when the database cannot be reached.
  async ping(): Promise<void> {
    await this.pool.query('select 1');
  }

  // Commit on success, rollback on any error; the repositories inside share the transaction.
  transaction<T>(work: (repos: Repositories, client: pg.PoolClient) => Promise<T>): Promise<T> {
    return withTransaction(this.pool, (client) => work(createRepositories(client), client));
  }
}
