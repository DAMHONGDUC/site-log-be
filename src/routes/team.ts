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

// F19 team calls (01-api §13).
export function teamRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  requireUser: preHandlerAsyncHookHandler,
  requireSignedIn: preHandlerAsyncHookHandler,
): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  const { pool, config } = deps;
  const RoleSchema = Type.Union(ROLES.map((role) => Type.Literal(role)));
  const Uuid = Type.String({ format: 'uuid' });

  async function me(member: Member) {
    const reach = await reachable(pool, member);
    return {
      uid: member.uid,
      email: member.email,
      name: member.name,
      role: member.role,
      projectIds: reach,
    };
  }

  // 14. Who am I
  typed.get('/me', { preHandler: requireUser }, async (request) => {
    await pool.query('update members set last_seen_at = now() where uid = $1', [request.uid]);
    return me(request.member);
  });

  // 15. Members and pending invitations
  typed.get('/members', { preHandler: requireUser }, async (request) => {
    allow(request, 'members.read');
    const members = await pool.query<{
      uid: string;
      email: string;
      name: string;
      role: Role;
      last_seen_at: Date | null;
      project_ids: string[];
    }>(
      `select m.uid, m.email, m.name, m.role, m.last_seen_at,
              coalesce(array_agg(pm.project_id order by pm.project_id)
                       filter (where pm.project_id is not null), '{}') as project_ids
         from members m left join project_members pm on pm.uid = m.uid
        where m.removed_at is null
        group by m.uid
        order by m.name, m.email`,
    );
    const invitations = await pool.query<{
      id: string;
      email: string;
      role: Role;
      project_ids: string[];
      expires_at: Date;
    }>(
      `select id, email, role, project_ids, expires_at from invitations
        where accepted_at is null and cancelled_at is null and expires_at > now()
        order by created_at`,
    );
    return {
      members: members.rows.map((row) => ({
        uid: row.uid,
        email: row.email,
        name: row.name,
        role: row.role,
        projectIds: projectIdsOf(row.role, row.project_ids),
        lastSeenAt: row.last_seen_at,
      })),
      invitations: invitations.rows.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        projectIds: row.project_ids,
        expiresAt: row.expires_at,
      })),
    };
  });

  // 16. Invite
  const InviteBody = Type.Object({
    email: Type.String({ minLength: 3, maxLength: 254 }),
    role: Type.String(),
    projectIds: Type.Array(Uuid, { maxItems: 200 }),
  });
  typed.post(
    '/invitations',
    { preHandler: requireUser, schema: { body: InviteBody } },
    async (request) => {
      allow(request, 'team.manage');
      const email = request.body.email.trim().toLowerCase();
      if (!EMAIL.test(email)) {
        throw badRequest('invalid_email', 'This is not an email address');
      }
      if (!(ROLES as string[]).includes(request.body.role)) {
        throw badRequest('invalid_role', 'Role must be admin, manager, inspector or viewer');
      }
      const role = request.body.role as Role;
      const projectIds = [...new Set(request.body.projectIds.map((id) => id.toLowerCase()))];
      await checkProjects(pool, projectIds);
      const existing = await pool.query(
        'select 1 from members where lower(email) = $1 and removed_at is null',
        [email],
      );
      if (existing.rows.length > 0) {
        throw conflict('already_member', 'This email already belongs to a member');
      }
      const token = newInviteToken();
      const invitation = await withTransaction(pool, async (client) => {
        // A new invite for the same email replaces an open one.
        await client.query(
          `update invitations set cancelled_at = now()
          where lower(email) = $1 and accepted_at is null and cancelled_at is null`,
          [email],
        );
        const inserted = await client.query<{ id: string; expires_at: Date }>(
          `insert into invitations (email, role, project_ids, token_hash, invited_by, expires_at)
         values ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
         returning id, expires_at`,
          [email, role, projectIds, hashToken(token), request.uid, config.inviteTtlDays],
        );
        const row = inserted.rows[0]!;
        await recordMemberEvent(client, {
          actorUid: request.uid,
          type: 'invited',
          invitationId: row.id,
          detail: { email, role, projectIds },
        });
        return row;
      });
      await deps.mailer.send(inviteMail(config, email, request.member.name, role, token));
      request.log.info({ uid: request.uid, invitationId: invitation.id, role }, 'member invited');
      return { invitationId: invitation.id, expiresAt: invitation.expires_at };
    },
  );

  interface InvitationRow {
    id: string;
    email: string;
    role: Role;
    project_ids: string[];
    invited_by: string;
    expires_at: Date;
    accepted_at: Date | null;
    cancelled_at: Date | null;
  }

  async function findByToken(client: pg.Pool | pg.PoolClient, token: string, lock = false) {
    const result = await client.query<InvitationRow>(
      `select id, email, role, project_ids, invited_by, expires_at, accepted_at, cancelled_at
         from invitations where token_hash = $1 ${lock ? 'for update' : ''}`,
      [hashToken(token)],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw notFound('invite_not_found', 'This invite does not exist');
    }
    if (row.accepted_at !== null) {
      throw conflict('invite_used', 'This invite was already used');
    }
    if (row.cancelled_at !== null || row.expires_at.getTime() < Date.now()) {
      throw conflict('invite_expired', 'This invite has expired or was replaced');
    }
    return row;
  }

  // 18. Preview an invite before sign-in: the link itself is the key.
  const TokenParams = Type.Object({ token: Type.String({ pattern: TOKEN_PATTERN }) });
  typed.get(
    '/invitations/:token',
    {
      schema: { params: TokenParams },
      config: {
        rateLimit: { max: config.invitePreviewRateLimitPerMinute, timeWindow: '1 minute' },
      },
    },
    async (request) => {
      const row = await findByToken(pool, request.params.token);
      const inviter = await pool.query<{ name: string; email: string }>(
        'select name, email from members where uid = $1',
        [row.invited_by],
      );
      const names = await projectNames(pool, row.project_ids);
      return {
        invitedBy: inviter.rows[0]?.name || inviter.rows[0]?.email || 'An Admin',
        role: row.role,
        projects: row.project_ids.map((id) => ({ id, name: names.get(id) ?? '' })),
        email: maskEmail(row.email),
        expiresAt: row.expires_at,
      };
    },
  );

  // 17. Accept: signed in (any Firebase user), email must match the invite.
  const AcceptBody = Type.Object({ token: Type.String({ pattern: TOKEN_PATTERN }) });
  typed.post(
    '/invitations/accept',
    { preHandler: requireSignedIn, schema: { body: AcceptBody } },
    async (request) => {
      const uid = request.uid;
      const result = await withTransaction(pool, async (client) => {
        const row = await findByToken(client, request.body.token, true);
        if ((request.email ?? '').toLowerCase() !== row.email.toLowerCase()) {
          throw conflict('email_mismatch', 'Sign in with the email the invite was sent to');
        }
        await client.query(
          `insert into members (uid, email, name, role, resync_required)
           values ($1, $2, $3, $4, true)
           on conflict (uid) do update
             set email = excluded.email, role = excluded.role, removed_at = null, resync_required = true`,
          [uid, row.email, row.email.split('@')[0] ?? '', row.role],
        );
        await setMemberProjects(client, uid, row.project_ids, row.invited_by);
        await client.query(
          'update invitations set accepted_at = now(), accepted_by = $2 where id = $1',
          [row.id, uid],
        );
        await recordMemberEvent(client, {
          actorUid: uid,
          type: 'joined',
          subjectUid: uid,
          invitationId: row.id,
          detail: { role: row.role, projectIds: row.project_ids },
        });
        return row;
      });
      request.log.info({ uid, invitationId: result.id, role: result.role }, 'invite accepted');
      return { uid, role: result.role, projectIds: projectIdsOf(result.role, result.project_ids) };
    },
  );

  const IdParams = Type.Object({ id: Uuid });

  async function openInvitation(client: pg.PoolClient, id: string): Promise<InvitationRow> {
    const result = await client.query<InvitationRow>(
      `select id, email, role, project_ids, invited_by, expires_at, accepted_at, cancelled_at
         from invitations where id = $1 for update`,
      [id],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw notFound('invite_not_found', 'No such invite');
    }
    if (row.accepted_at !== null) {
      throw conflict('invite_accepted', 'This invite was already accepted');
    }
    return row;
  }

