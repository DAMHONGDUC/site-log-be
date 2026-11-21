import { and, asc, count, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { ROLE, type Role } from '../../constants/roles.js';
import type { SqlDb } from '../../data/drizzle.js';
import { members, projectMembers } from '../../data/schema/index.js';

export interface MemberRow {
  uid: string;
  email: string;
  name: string;
  role: Role;
  resyncRequired: boolean;
  removedAt: Date | null;
}

export interface MemberListRow {
  uid: string;
  email: string;
  name: string;
  role: Role;
  lastSeenAt: Date | null;
  projectIds: string[];
}

const isLive = isNull(members.removedAt);

export class MemberRepository {
  constructor(private readonly db: SqlDb) {}

  async find(uid: string): Promise<MemberRow | undefined> {
    const [row] = await this.db
      .select({
        uid: members.uid,
        email: members.email,
        name: members.name,
        role: members.role,
        resyncRequired: members.resyncRequired,
        removedAt: members.removedAt,
      })
      .from(members)
      .where(eq(members.uid, uid));
    return row;
  }

  // Locks the row for the rest of the transaction.
  async findLiveForUpdate(uid: string): Promise<{ role: Role } | undefined> {
    const [row] = await this.db
      .select({ role: members.role })
      .from(members)
      .where(and(eq(members.uid, uid), isLive))
      .for('update');
    return row;
  }

  async listLive(): Promise<MemberListRow[]> {
    const projectId = projectMembers.projectId;
    return this.db
      .select({
        uid: members.uid,
        email: members.email,
        name: members.name,
        role: members.role,
        lastSeenAt: members.lastSeenAt,
        projectIds: sql<string[]>`coalesce(array_agg(${projectId} order by ${projectId})
          filter (where ${projectId} is not null), '{}')`,
      })
      .from(members)
      .leftJoin(projectMembers, eq(projectMembers.uid, members.uid))
      .where(isLive)
      .groupBy(members.uid)
      .orderBy(asc(members.name), asc(members.email));
  }

  async liveUidsAmong(uids: string[]): Promise<string[]> {
    const rows = await this.db
      .select({ uid: members.uid })
      .from(members)
      .where(and(inArray(members.uid, uids), isLive));
    return rows.map((row) => row.uid);
  }

  // Admins and Managers reach every project; the others reach the projects they were added to.
  async liveUidsReaching(projectId: string, rolesReachingAll: readonly Role[]): Promise<string[]> {
    const addedToProject = this.db
      .select({ uid: projectMembers.uid })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, projectId));
    const rows = await this.db
      .select({ uid: members.uid })
      .from(members)
      .where(
        and(
          isLive,
          or(inArray(members.role, [...rolesReachingAll]), inArray(members.uid, addedToProject)),
        ),
      );
    return rows.map((row) => row.uid);
  }

  async liveEmailExists(email: string): Promise<boolean> {
    const rows = await this.db
      .select({ uid: members.uid })
      .from(members)
      .where(and(eq(sql`lower(${members.email})`, sql`lower(${email})`), isLive));
    return rows.length > 0;
  }

  async countLiveWithRole(role: Role): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(members)
      .where(and(eq(members.role, role), isLive));
    return row!.count;
  }

  async displayName(uid: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ name: members.name, email: members.email })
      .from(members)
      .where(eq(members.uid, uid));
    return row === undefined ? undefined : row.name || row.email;
  }

  // A new member, or a removed one coming back through an invitation.
  async upsertFromInvitation(uid: string, email: string, name: string, role: Role): Promise<void> {
    await this.db
      .insert(members)
      .values({ uid, email, name, role, resyncRequired: true })
      .onConflictDoUpdate({
        target: members.uid,
        set: { email, role, removedAt: null, resyncRequired: true },
      });
  }

  async createAdmin(uid: string, email: string, name: string): Promise<void> {
    await this.db
      .insert(members)
      .values({ uid, email, name, role: ROLE.admin })
      .onConflictDoUpdate({ target: members.uid, set: { role: ROLE.admin, removedAt: null } });
  }

  async setRole(uid: string, role: Role): Promise<void> {
    await this.db.update(members).set({ role }).where(eq(members.uid, uid));
  }

  async requireResync(uid: string): Promise<void> {
    await this.db.update(members).set({ resyncRequired: true }).where(eq(members.uid, uid));
  }

  async clearResync(uid: string): Promise<void> {
    await this.db.update(members).set({ resyncRequired: false }).where(eq(members.uid, uid));
  }

  async touchLastSeen(uid: string): Promise<void> {
    await this.db
      .update(members)
      .set({ lastSeenAt: sql`now()` })
      .where(eq(members.uid, uid));
  }

  // true when a live member was removed now.
  async markRemoved(uid: string): Promise<boolean> {
    const result = await this.db
      .update(members)
      .set({ removedAt: sql`now()` })
      .where(and(eq(members.uid, uid), isLive));
    return (result.rowCount ?? 0) > 0;
  }
}
