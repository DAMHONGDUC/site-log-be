import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiRoutes } from '../../../src/constants/http/api-routes.js';
import { can } from '../../../src/modules/team/access/permissions.js';
import {
  addMember,
  auth,
  workerDeps,
  closeTestContext,
  createTestContext,
  ids,
  resetDatabase,
  type TestContext,
} from '../../helpers/helpers.js';
import { pullAs, pushAs, seedProject } from '../../helpers/sync-helpers.js';

// F19: one company, four roles, shared projects (05-team-and-roles, 01-api §13).
describe('team and roles', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext();
  });
  afterAll(async () => {
    await closeTestContext(context);
  });
  beforeEach(async () => {
    await resetDatabase(context.pool);
    context.mailer.sent = [];
    context.push.sent = [];
  });

  const call = (uid: string, method: string, url: string, payload?: object) =>
    context.app.inject({
      method: method as 'GET',
      url,
      headers: { authorization: `Bearer uid:${uid}` },
      ...(payload === undefined ? {} : { payload }),
    });

  const tokenFromMail = () => {
    const text = context.mailer.sent.at(-1)!.text;

    return /invite\/([A-Za-z0-9_-]{43})/.exec(text)![1]!;
  };

  const issue = (fields: Record<string, unknown>, at = '2026-11-01T09:00:00.000Z') => ({
    table: 'issues',
    id: '55555555-5555-4555-8555-555555555555',
    op: 'upsert',
    clientUpdatedAt: at,
    fields: {
      projectId: ids.project,
      locationId: ids.location,
      title: 'Hairline crack',
      detail: '',
      severity: 'major',
      status: 'open',
      dueDate: null,
      assigneeName: null,
      assigneeUid: null,
      trade: null,
      planSheetId: null,
      pinX: null,
      pinY: null,
      resolvedByIssueId: null,
      sourceChecklistResultId: null,
      ...fields,
    },
  });

  it('matches the permission table', () => {
    expect(can('admin', 'project.delete')).toBe(true);
    expect(can('manager', 'project.delete')).toBe(false);
    expect(can('manager', 'project.members')).toBe(true);
    expect(can('manager', 'team.manage')).toBe(false);
    expect(can('inspector', 'issue.write')).toBe(true);
    expect(can('inspector', 'plan.edit')).toBe(false);
    expect(can('inspector', 'issue.delete')).toBe(false);
    expect(can('inspector', 'issue.delete', { ownSameDay: true })).toBe(true);
    expect(can('viewer', 'issue.write')).toBe(false);
    expect(can('viewer', 'phrase.write')).toBe(true);
  });

  it('answers /me with the role and reachable projects', async () => {
    await seedProject(context);
    await addMember(context.pool, 'bob', 'inspector', [ids.project]);
    expect((await call('alice', 'GET', ApiRoutes.ME)).json()).toMatchObject({
      role: 'admin',
      projectIds: 'all',
    });
    expect((await call('bob', 'GET', ApiRoutes.ME)).json()).toMatchObject({
      role: 'inspector',
      projectIds: [ids.project],
    });
  });

  it('invites, previews without sign-in, and accepts with the matching email', async () => {
    await seedProject(context);
    const invited = await call('alice', 'POST', ApiRoutes.INVITATIONS, {
      email: 'Vu@Eastline.vn',
      role: 'inspector',
      projectIds: [ids.project],
    });

    expect(invited.statusCode).toBe(200);
    const token = tokenFromMail();

    const preview = await context.app.inject({
      method: 'GET',
      url: ApiRoutes.invitationPreview(token),
    });

    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      invitedBy: 'Alice',
      role: 'inspector',
      projects: [{ id: ids.project, name: 'Tower A' }],
      email: 'v••@eastline.vn',
    });

    const wrong = await context.app.inject({
      method: 'POST',
      url: ApiRoutes.INVITATION_ACCEPT,
      headers: { authorization: 'Bearer uid:vu|someone@else.dev' },
      payload: { token },
    });

    expect(wrong.json().error.code).toBe('email_mismatch');

    const accepted = await context.app.inject({
      method: 'POST',
      url: ApiRoutes.INVITATION_ACCEPT,
      headers: { authorization: 'Bearer uid:vu|vu@eastline.vn' },
      payload: { token },
    });

    expect(accepted.json()).toEqual({ uid: 'vu', role: 'inspector', projectIds: [ids.project] });

    const again = await context.app.inject({
      method: 'GET',
      url: ApiRoutes.invitationPreview(token),
    });

    expect(again.json().error.code).toBe('invite_used');
    // A new member rebuilds from 0, then sees the project.
    expect(await pullAs(context, 'vu', 0)).toEqual({ resyncRequired: true });
    expect((await pullAs(context, 'vu', 0)).changes.projects).toHaveLength(1);
  });

  it('only lets an Admin invite, and refuses an email that is already a member', async () => {
    await addMember(context.pool, 'mia', 'manager');
    const manager = await call('mia', 'POST', ApiRoutes.INVITATIONS, {
      email: 'x@y.dev',
      role: 'viewer',
      projectIds: [],
    });

    expect(manager.statusCode).toBe(403);
    const member = await call('alice', 'POST', ApiRoutes.INVITATIONS, {
      email: 'bob@test.dev',
      role: 'viewer',
      projectIds: [],
    });

    expect(member.json().error.code).toBe('already_member');
    const badRole = await call('alice', 'POST', ApiRoutes.INVITATIONS, {
      email: 'x@y.dev',
      role: 'boss',
      projectIds: [],
    });

    expect(badRole.json().error.code).toBe('invalid_role');
  });

  it('resend voids the old link; cancel closes the invite', async () => {
    const invited = await call('alice', 'POST', ApiRoutes.INVITATIONS, {
      email: 'qa@aquaseal.vn',
      role: 'viewer',
      projectIds: [],
    });
    const id = invited.json().invitationId;
    const oldToken = tokenFromMail();
    const resent = await call('alice', 'POST', ApiRoutes.invitationResend(id));

    expect(resent.statusCode).toBe(200);
    const newToken = tokenFromMail();

    expect(newToken).not.toBe(oldToken);
    const old = await context.app.inject({
      method: 'GET',
      url: ApiRoutes.invitationPreview(oldToken),
    });

    expect(old.json().error.code).toBe('invite_not_found');

    const members = await call('alice', 'GET', ApiRoutes.MEMBERS);

    expect(members.json().invitations).toHaveLength(1);
    expect((await call('alice', 'DELETE', ApiRoutes.invitation(id))).json()).toEqual({
      cancelled: true,
    });
    const fresh = await context.app.inject({
      method: 'GET',
      url: ApiRoutes.invitationPreview(newToken),
    });

    expect(fresh.json().error.code).toBe('invite_expired');
  });

  it('changes role and projects in one PATCH, asks for a resync and pushes `access`', async () => {
    await seedProject(context);
    await context.pool.query(
      `insert into devices (token, uid, platform) values ('fX3k:APA91b${'b'.repeat(30)}', 'bob', 'ios')`,
    );
    const patched = await call('alice', 'PATCH', ApiRoutes.member('bob'), {
      role: 'viewer',
      projectIds: [ids.project],
    });

    expect(patched.json()).toEqual({ uid: 'bob', role: 'viewer', projectIds: [ids.project] });
    expect(await pullAs(context, 'bob', 0)).toEqual({ resyncRequired: true });
    const kinds = context.push.sent.map((item) => item.message.kind);

    expect(kinds).toEqual(['access', 'access']);
    expect(context.push.sent[1]!.message.deepLink).toBe(`sitelog://project/${ids.project}`);
  });

  it('never demotes or removes the last Admin', async () => {
    const demote = await call('alice', 'PATCH', ApiRoutes.member('alice'), { role: 'manager' });

    expect(demote.json().error.code).toBe('last_admin');
    const remove = await call('alice', 'DELETE', ApiRoutes.member('alice'));

    expect(remove.json().error.code).toBe('last_admin');
  });

  it('removes a member: tokens revoked, then 401', async () => {
    expect((await call('alice', 'DELETE', ApiRoutes.member('carol'))).json()).toEqual({
      removed: true,
    });
    expect(context.tokens.revokedUsers).toContain('carol');
    expect((await call('carol', 'GET', ApiRoutes.ME)).statusCode).toBe(401);
  });

  it('sets who works on a project and keeps Inspectors apart', async () => {
    await seedProject(context);
    const set = await call('alice', 'PUT', ApiRoutes.projectMembers(ids.project), {
      uids: ['bob'],
    });

    expect(set.json()).toEqual({ projectId: ids.project, uids: ['bob'] });
    await pullAs(context, 'bob', 0); // clears the resync flag
    expect((await pullAs(context, 'bob', 0)).changes.projects).toHaveLength(1);
    expect((await pullAs(context, 'carol', 0)).changes).toEqual({});
    const inspector = await call('bob', 'PUT', ApiRoutes.projectMembers(ids.project), { uids: [] });

    expect(inspector.statusCode).toBe(403);
  });

  it('lets Inspectors work on their project but not edit rooms; Viewers only read', async () => {
    await seedProject(context);
    await addMember(context.pool, 'bob', 'inspector', [ids.project]);
    await addMember(context.pool, 'vera', 'viewer', [ids.project]);
    const logged = await pushAs(context, 'bob', [issue({})]);

    expect(logged.results[0].status).toBe('applied');
    const room = await pushAs(context, 'bob', [
      {
        table: 'locations',
        id: '66666666-6666-4666-8666-666666666666',
        op: 'upsert',
        clientUpdatedAt: '2026-11-01T09:00:00.000Z',
        fields: { projectId: ids.project, parentId: null, code: 'L2', kind: 'floor', sortIndex: 1 },
      },
    ]);

    expect(room.results[0].reason).toBe('forbidden:location.edit');
    const viewer = await pushAs(context, 'vera', [
      issue({ title: 'x' }, '2026-11-02T09:00:00.000Z'),
    ]);

    expect(viewer.results[0].reason).toBe('forbidden:issue.write');
    const pulled = await pullAs(context, 'vera', 0);

    expect(pulled.changes.issues[0].createdBy).toBe('bob');
  });

  it('lets an Inspector delete only their own issue of today', async () => {
    await seedProject(context);
    await addMember(context.pool, 'bob', 'inspector', [ids.project]);
    await addMember(context.pool, 'carol', 'inspector', [ids.project]);
    await pushAs(context, 'bob', [issue({})]);
    const remove = (uid: string, at: string) =>
      pushAs(context, uid, [
        { table: 'issues', id: issue({}).id, op: 'delete', clientUpdatedAt: at, fields: {} },
      ]);

    expect((await remove('carol', '2026-11-03T09:00:00.000Z')).results[0].reason).toBe(
      'forbidden:issue.delete',
    );
    expect((await remove('bob', '2026-11-03T09:00:00.000Z')).results[0].status).toBe('applied');
  });

  it('pushes issueAssigned to a new assignee and issueRechecked to creator and assignee', async () => {
    await seedProject(context);
    await addMember(context.pool, 'bob', 'inspector', [ids.project]);
    for (const uid of ['alice', 'bob']) {
      await context.app.inject({
        method: 'POST',
        url: ApiRoutes.DEVICES,
        headers: auth(uid),
        payload: { token: `fX3k:APA91b${uid.repeat(10)}`, platform: 'android' },
      });
    }
    await pushAs(context, 'alice', [issue({ assigneeUid: 'bob', dueDate: '2026-11-07' })]);
    expect(context.push.sent.map((item) => [item.message.kind, item.message.title])).toEqual([
      ['issueAssigned', 'Assigned to you · Major'],
    ]);
    context.push.sent = [];
    await pushAs(context, 'bob', [
      issue({ assigneeUid: 'bob', status: 'resolved' }, '2026-11-02T09:00:00.000Z'),
    ]);
    // bob made the change, so only alice (the creator) hears about it.
    expect(context.push.sent.map((item) => item.message.kind)).toEqual(['issueRechecked']);
  });

  it('honours the kinds a device asked for', async () => {
    await seedProject(context);
    await addMember(context.pool, 'bob', 'inspector', [ids.project]);
    await context.app.inject({
      method: 'POST',
      url: ApiRoutes.DEVICES,
      headers: auth('bob'),
      payload: { token: `fX3k:APA91b${'c'.repeat(20)}`, platform: 'ios', kinds: ['dueSoon'] },
    });
    await pushAs(context, 'alice', [issue({ assigneeUid: 'bob' })]);
    expect(context.push.sent).toHaveLength(0);
  });

  it('sends one dueSoon push per assignee and project', async () => {
    await seedProject(context);
    await addMember(context.pool, 'bob', 'inspector', [ids.project]);
    await context.pool.query(
      `insert into devices (token, uid, platform) values ('fX3k:APA91b${'d'.repeat(20)}', 'bob', 'android')`,
    );
    const tomorrow = await context.pool.query<{ day: string }>(
      `select ((now() at time zone 'Asia/Ho_Chi_Minh')::date + 1)::text as day`,
    );

    await pushAs(context, 'alice', [issue({ assigneeUid: 'bob', dueDate: tomorrow.rows[0]!.day })]);
    context.push.sent = [];
    const sent = await workerDeps(context, context.push).services.dueSoon.run();

    expect(sent).toBe(1);
    expect(context.push.sent[0]!.message).toMatchObject({
      kind: 'dueSoon',
      title: '1 issue due tomorrow',
      deepLink: `sitelog://project/${ids.project}`,
    });
  });

  it('records the team activity, newest first, paged', async () => {
    await call('alice', 'PATCH', ApiRoutes.member('bob'), { role: 'viewer' });
    await call('alice', 'PATCH', ApiRoutes.member('carol'), { role: 'viewer' });
    await call('alice', 'DELETE', ApiRoutes.member('carol'));
    const first = await call('alice', 'GET', `${ApiRoutes.MEMBER_EVENTS}?limit=2`);

    expect(first.json().events.map((event: { type: string }) => event.type)).toEqual([
      'removed',
      'role_changed',
    ]);
    expect(first.json().events[1].subject).toEqual({ uid: 'carol', name: 'Carol' });
    const second = await call(
      'alice',
      'GET',
      `${ApiRoutes.MEMBER_EVENTS}?limit=2&before=${first.json().next}`,
    );

    expect(second.json().events).toHaveLength(1);
    expect(second.json().next).toBeNull();
    expect((await call('bob', 'GET', ApiRoutes.MEMBER_EVENTS)).statusCode).toBe(403);
  });
});

describe('move-keys (F19)', () => {
  it('maps old uid keys to project and company keys', async () => {
    const { newKeyFor } =
      await import('../../../src/modules/uploads/keys/key-migration-service.js');

    expect(newKeyFor(`alice/${ids.project}/${ids.session}/${ids.capture}.jpg`)).toBe(
      `projects/${ids.project}/${ids.session}/${ids.capture}.jpg`,
    );
    expect(newKeyFor(`alice/${ids.project}/plans/${ids.capture}.pdf`)).toBe(
      `projects/${ids.project}/plans/${ids.capture}.pdf`,
    );
    expect(newKeyFor(`alice/branding/${ids.capture}.png`)).toBe(
      `company/branding/${ids.capture}.png`,
    );
    expect(newKeyFor(`projects/${ids.project}/x.jpg`)).toBeUndefined();
  });
});
