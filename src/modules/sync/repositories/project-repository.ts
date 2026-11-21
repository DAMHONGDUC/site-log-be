import { and, inArray, isNull } from 'drizzle-orm';
import type { SqlDb } from '../../../data/drizzle.js';
import { projects } from '../../../data/schema/index.js';

export class ProjectRepository {
  constructor(private readonly db: SqlDb) {}

  async namesByIds(ids: string[]): Promise<Map<string, string>> {
    const rows = await this.db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(inArray(projects.id, ids));
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  async liveIdsAmong(ids: string[]): Promise<string[]> {
    const rows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(inArray(projects.id, ids), isNull(projects.deletedAt)));
    return rows.map((row) => row.id);
  }
}
