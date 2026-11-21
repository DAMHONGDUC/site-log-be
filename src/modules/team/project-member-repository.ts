import type { Queryable } from '../../data/database.js';

export class ProjectMemberRepository {
  constructor(private readonly db: Queryable) {}

  async projectsOf(uid: string): Promise<string[]> {
    const result = await this.db.query<{ project_id: string }>(
      'select project_id from project_members where uid = $1 order by project_id',
      [uid],
    );
    return result.rows.map((row) => row.project_id);
  }

  async membersOf(projectId: string): Promise<string[]> {
    const result = await this.db.query<{ uid: string }>(
      'select uid from project_members where project_id = $1 order by uid',
      [projectId],
    );
    return result.rows.map((row) => row.uid);
  }

  async add(projectId: string, uid: string, addedBy: string | null): Promise<void> {
    await this.db.query(
      'insert into project_members (project_id, uid, added_by) values ($1, $2, $3) on conflict do nothing',
      [projectId, uid, addedBy],
    );
  }

  async remove(projectId: string, uid: string): Promise<void> {
    await this.db.query('delete from project_members where project_id = $1 and uid = $2', [
      projectId,
      uid,
    ]);
  }

  // Number of rows removed.
  async removeAllFor(uid: string): Promise<number> {
    const result = await this.db.query('delete from project_members where uid = $1', [uid]);
    return result.rowCount ?? 0;
  }
}
