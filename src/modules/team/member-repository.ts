import type { Role } from '../../constants/roles.js';
import type { Queryable } from '../../data/database.js';

export interface MemberRow {
  uid: string;
  email: string;
  name: string;
  role: Role;
  resync_required: boolean;
  removed_at: Date | null;
}

export interface MemberListRow {
  uid: string;
  email: string;
  name: string;
  role: Role;
  last_seen_at: Date | null;
  project_ids: string[];
}

export class MemberRepository {
  constructor(private readonly db: Queryable) {}

  async find(uid: string): Promise<MemberRow | undefined> {
    const result = await this.db.query<MemberRow>(
      'select uid, email, name, role, resync_required, removed_at from members where uid = $1',
      [uid],
    );
    return result.rows[0];
  }

  // Locks the row for the rest of the transaction.
  async findLiveForUpdate(uid: string): Promise<{ role: Role } | undefined> {
    const result = await this.db.query<{ role: Role }>(
      'select role from members where uid = $1 and removed_at is null for update',
      [uid],
    );
    return result.rows[0];
  }

  async listLive(): Promise<MemberListRow[]> {
    const result = await this.db.query<MemberListRow>(
      `select m.uid, m.email, m.name, m.role, m.last_seen_at,
              coalesce(array_agg(pm.project_id order by pm.project_id)
                       filter (where pm.project_id is not null), '{}') as project_ids
         from members m left join project_members pm on pm.uid = m.uid
        where m.removed_at is null
        group by m.uid
        order by m.name, m.email`,
    );
    return result.rows;
  }

  async liveUidsAmong(uids: string[]): Promise<string[]> {
    const result = await this.db.query<{ uid: string }>(
      'select uid from members where uid = any($1) and removed_at is null',
      [uids],
    );
    return result.rows.map((row) => row.uid);
  }

  // Admins and Managers reach every project; the others reach the projects they were added to.
  async liveUidsReaching(projectId: string, rolesReachingAll: readonly Role[]): Promise<string[]> {
    const result = await this.db.query<{ uid: string }>(
      `select uid from members
        where removed_at is null
          and (role = any($2) or uid in (select uid from project_members where project_id = $1))`,
      [projectId, rolesReachingAll],
    );
    return result.rows.map((row) => row.uid);
  }

  async liveEmailExists(email: string): Promise<boolean> {
    const result = await this.db.query(
      'select 1 from members where lower(email) = lower($1) and removed_at is null',
      [email],
    );
    return result.rows.length > 0;
  }

  async countLiveWithRole(role: Role): Promise<number> {
    const result = await this.db.query<{ count: number }>(
      'select count(*)::int as count from members where role = $1 and removed_at is null',
      [role],
    );
    return result.rows[0]!.count;
  }

  async displayName(uid: string): Promise<string | undefined> {
    const result = await this.db.query<{ name: string; email: string }>(
      'select name, email from members where uid = $1',
      [uid],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : row.name || row.email;
  }

  // A new member, or a removed one coming back through an invitation.
  async upsertFromInvitation(uid: string, email: string, name: string, role: Role): Promise<void> {
    await this.db.query(
      `insert into members (uid, email, name, role, resync_required)
       values ($1, $2, $3, $4, true)
       on conflict (uid) do update
         set email = excluded.email, role = excluded.role, removed_at = null, resync_required = true`,
      [uid, email, name, role],
    );
  }

  async createAdmin(uid: string, email: string, name: string): Promise<void> {
    await this.db.query(
      `insert into members (uid, email, name, role) values ($1, $2, $3, 'admin')
       on conflict (uid) do update set role = 'admin', removed_at = null`,
      [uid, email, name],
    );
  }

  async setRole(uid: string, role: Role): Promise<void> {
    await this.db.query('update members set role = $2 where uid = $1', [uid, role]);
  }

  async requireResync(uid: string): Promise<void> {
    await this.db.query('update members set resync_required = true where uid = $1', [uid]);
  }

  async clearResync(uid: string): Promise<void> {
    await this.db.query('update members set resync_required = false where uid = $1', [uid]);
  }

  async touchLastSeen(uid: string): Promise<void> {
    await this.db.query('update members set last_seen_at = now() where uid = $1', [uid]);
  }

  // true when a live member was removed now.
  async markRemoved(uid: string): Promise<boolean> {
    const result = await this.db.query(
      'update members set removed_at = now() where uid = $1 and removed_at is null',
      [uid],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
