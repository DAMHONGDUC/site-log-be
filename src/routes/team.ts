import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type pg from 'pg';
import type { AppDeps } from '../app.js';
import { withTransaction } from '../db.js';
import { AppError, badRequest, conflict, notFound } from '../errors.js';
import { notify } from '../push/notify.js';
import { reachable, type Member } from '../team/access.js';
import { recordMemberEvent } from '../team/events.js';
import {
  hashToken,
  inviteMail,
  maskEmail,
  newInviteToken,
  TOKEN_PATTERN,
} from '../team/invitations.js';
import { can, ROLES, type Action, type Role } from '../team/permissions.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLE_NAME: Record<Role, string> = {
  admin: 'Admin',
  manager: 'Manager',
  inspector: 'Inspector',
  viewer: 'Viewer',
};

function allow(request: FastifyRequest, action: Action): void {
  if (!can(request.member.role, action)) {
    throw new AppError(403, 'forbidden', 'Not allowed for your role');
  }
}

function projectIdsOf(role: Role, ids: string[]): string[] | 'all' {
  return role === 'admin' || role === 'manager' ? 'all' : ids;
}

async function memberProjects(pool: pg.Pool | pg.PoolClient, uid: string): Promise<string[]> {
  const result = await pool.query<{ project_id: string }>(
    'select project_id from project_members where uid = $1 order by project_id',
    [uid],
  );
  return result.rows.map((row) => row.project_id);
}

async function liveAdmins(client: pg.Pool | pg.PoolClient): Promise<number> {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count from members where role = 'admin' and removed_at is null`,
  );
  return Number(result.rows[0]!.count);
}

async function projectNames(pool: pg.Pool, ids: string[]): Promise<Map<string, string>> {
  const result = await pool.query<{ id: string; name: string }>(
    'select id, name from projects where id = any($1)',
    [ids],
  );
  return new Map(result.rows.map((row) => [row.id, row.name]));
}

async function checkProjects(client: pg.Pool | pg.PoolClient, ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const found = await client.query<{ id: string }>(
    'select id from projects where id = any($1) and deleted_at is null',
    [ids],
  );
  if (found.rows.length !== new Set(ids).size) {
    throw notFound('project_not_found', 'One of the projects does not exist');
  }
}

// Replaces a member's projects; returns what was added and removed.
async function setMemberProjects(
  client: pg.PoolClient,
  uid: string,
  projectIds: string[],
  actor: string,
): Promise<{ added: string[]; removed: string[] }> {
  const before = await memberProjects(client, uid);
  const wanted = [...new Set(projectIds.map((id) => id.toLowerCase()))];
  const added = wanted.filter((id) => !before.includes(id));
  const removed = before.filter((id) => !wanted.includes(id));
  if (removed.length > 0) {
    await client.query('delete from project_members where uid = $1 and project_id = any($2)', [
      uid,
      removed,
    ]);
  }
  for (const projectId of added) {
    await client.query(
      'insert into project_members (project_id, uid, added_by) values ($1, $2, $3)',
      [projectId, uid, actor],
    );
  }
  return { added, removed };
}

// The `access` push: added to / removed from projects, or a new role.
async function notifyAccess(
  deps: AppDeps,
  request: FastifyRequest,
  uid: string,
  change: { added?: string[]; removed?: string[]; role?: Role },
): Promise<void> {
  const actorName = request.member.name || 'An Admin';
  if (change.role !== undefined) {
    await notify(deps.pool, deps.push, request.log, {
      kind: 'access',
      recipients: [uid],
      actorUid: request.member.uid,
      title: `Your role is now ${ROLE_NAME[change.role]}`,
      body: `${actorName} changed your role.`,
      deepLink: '',
    });
  }
  const ids = [...(change.added ?? []), ...(change.removed ?? [])];
  if (ids.length === 0) {
    return;
  }
  const names = await projectNames(deps.pool, ids);
  for (const projectId of change.added ?? []) {
    await notify(deps.pool, deps.push, request.log, {
      kind: 'access',
      recipients: [uid],
      actorUid: request.member.uid,
      title: `Added to ${names.get(projectId) ?? 'a project'}`,
      body: `${actorName} added you to this project.`,
      deepLink: `sitelog://project/${projectId}`,
    });
  }
  for (const projectId of change.removed ?? []) {
    await notify(deps.pool, deps.push, request.log, {
      kind: 'access',
      recipients: [uid],
      actorUid: request.member.uid,
      title: `Removed from ${names.get(projectId) ?? 'a project'}`,
      body: `${actorName} removed you from this project.`,
      deepLink: '',
    });
  }
}

