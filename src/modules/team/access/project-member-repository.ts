import { and, asc, eq } from 'drizzle-orm';
import type { SqlDb } from '../../../data/drizzle.js';
import { projectMembers } from '../../../data/schema/index.js';

export class ProjectMemberRepository {
  constructor(private readonly db: SqlDb) {}

  async projectsOf(uid: string): Promise<string[]> {
    const rows = await this.db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.uid, uid))
      .orderBy(asc(projectMembers.projectId));
    return rows.map((row) => row.projectId);
  }

  async membersOf(projectId: string): Promise<string[]> {
    const rows = await this.db
      .select({ uid: projectMembers.uid })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, projectId))
      .orderBy(asc(projectMembers.uid));
    return rows.map((row) => row.uid);
  }

  async add(projectId: string, uid: string, addedBy: string | null): Promise<void> {
    await this.db.insert(projectMembers).values({ projectId, uid, addedBy }).onConflictDoNothing();
  }

  async remove(projectId: string, uid: string): Promise<void> {
    await this.db
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.uid, uid)));
  }

  // Number of rows removed.
  async removeAllFor(uid: string): Promise<number> {
    const result = await this.db.delete(projectMembers).where(eq(projectMembers.uid, uid));
    return result.rowCount ?? 0;
  }
}
