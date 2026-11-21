import type pg from 'pg';
import type { Role } from './permissions.js';

export interface Member {
  uid: string;
  email: string;
  name: string;
  role: Role;
  resyncRequired: boolean;
}

// 'all' for Admins and Managers; otherwise the projects the member was added to.
export type Reach = 'all' | string[];

interface MemberRow {
  uid: string;
  email: string;
  name: string;
  role: Role;
  resync_required: boolean;
  removed_at: Date | null;
}

export type MemberLookup =
  { status: 'member'; member: Member } | { status: 'removed' } | { status: 'unknown' };

export async function loadMember(
  pool: pg.Pool | pg.PoolClient,
  uid: string,
): Promise<MemberLookup> {
  const result = await pool.query<MemberRow>(
    'select uid, email, name, role, resync_required, removed_at from members where uid = $1',
    [uid],
  );
  const row = result.rows[0];
  if (row === undefined) {
    return { status: 'unknown' };
  }
  if (row.removed_at !== null) {
    return { status: 'removed' };
  }
  return {
    status: 'member',
    member: {
      uid: row.uid,
      email: row.email,
      name: row.name,
      role: row.role,
      resyncRequired: row.resync_required,
    },
  };
}

// The one function every route, the sync pull, the upload signer, the WebSocket and push use.
export async function reachable(pool: pg.Pool | pg.PoolClient, member: Member): Promise<Reach> {
  if (member.role === 'admin' || member.role === 'manager') {
    return 'all';
  }
  const result = await pool.query<{ project_id: string }>(
    'select project_id from project_members where uid = $1',
    [member.uid],
  );
  return result.rows.map((row) => row.project_id);
}

export function reaches(reach: Reach, projectId: string | null): boolean {
  if (projectId === null) {
    return true;
  }
  if (reach === 'all') {
    return true;
  }
  return reach.includes(projectId);
}

// Every live member who reaches a project: Admins, Managers and the project's members.
export async function membersReaching(pool: pg.Pool, projectId: string): Promise<string[]> {
  const result = await pool.query<{ uid: string }>(
    `select uid from members
      where removed_at is null
        and (role in ('admin', 'manager')
             or uid in (select uid from project_members where project_id = $1))`,
    [projectId],
  );
  return result.rows.map((row) => row.uid);
}
