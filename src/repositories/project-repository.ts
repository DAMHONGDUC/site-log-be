import type { Queryable } from '../data/database.js';

export class ProjectRepository {
  constructor(private readonly db: Queryable) {}

  async namesByIds(ids: string[]): Promise<Map<string, string>> {
    const result = await this.db.query<{ id: string; name: string }>(
      'select id, name from projects where id = any($1)',
      [ids],
    );
    return new Map(result.rows.map((row) => [row.id, row.name]));
  }

  async liveIdsAmong(ids: string[]): Promise<string[]> {
    const result = await this.db.query<{ id: string }>(
      'select id from projects where id = any($1) and deleted_at is null',
      [ids],
    );
    return result.rows.map((row) => row.id);
  }
}
