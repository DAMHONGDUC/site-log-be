import { ApiRoutes } from '../../../../src/constants/http/api-routes.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auth,
  closeTestContext,
  createTestContext,
  ids,
  resetDatabase,
  type TestContext,
} from '../../../helpers/helpers.js';
import {
  locationMutation,
  projectMutation,
  pullAs,
  pushAs,
  sessionMutation,
} from '../../../helpers/sync-helpers.js';

describe('sync', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext();
  });
  afterAll(async () => {
    await closeTestContext(context);
  });
  beforeEach(async () => {
    await resetDatabase(context.pool);
  });

  const push = (uid: string, mutations: object[]) => pushAs(context, uid, mutations);
  const pull = (uid: string, since: number, limit = 500) => pullAs(context, uid, since, limit);

  it('applies a push and returns it on pull, without uid', async () => {
    const result = await push('alice', [
      projectMutation(ids.project, '2026-11-01T08:00:00.000Z', 'Tower A'),
    ]);

    expect(result.results).toEqual([{ id: ids.project, status: 'applied' }]);

    const pulled = await pull('alice', 0);

    expect(pulled.changes.projects).toHaveLength(1);
    expect(pulled.changes.projects[0].name).toBe('Tower A');
    expect(pulled.changes.projects[0].uid).toBeUndefined();
    expect(pulled.changes.projects[0].clientUpdatedAt).toBe('2026-11-01T08:00:00.000Z');
    expect(pulled.nextRev).toBe(result.serverRev);
    expect(pulled.hasMore).toBe(false);
  });

  it('never shows an Inspector a project they were not added to', async () => {
    await push('alice', [projectMutation(ids.project, '2026-11-01T08:00:00.000Z', 'Tower A')]);
    const pulled = await pull('bob', 0);

    expect(pulled.changes).toEqual({});
  });

  it('accepts a child before its parent in one batch', async () => {
    const result = await push('alice', [
      locationMutation('2026-11-01T08:00:00.000Z', 'L1'),
      projectMutation(ids.project, '2026-11-01T08:00:00.000Z', 'Tower A'),
    ]);

    expect(result.results.map((item: { status: string }) => item.status)).toEqual([
      'applied',
      'applied',
    ]);
  });

  it('rejects only the row whose parent never arrives', async () => {
    const orphan = locationMutation(
      '2026-11-01T08:00:00.000Z',
      'L9',
      '55555555-5555-4555-8555-555555555555',
    );

    orphan.fields = { ...orphan.fields, projectId: '66666666-6666-4666-8666-666666666666' };
    const result = await push('alice', [
      projectMutation(ids.project, '2026-11-01T08:00:00.000Z', 'Tower A'),
      orphan,
    ]);

    expect(result.results[0].status).toBe('applied');
    expect(result.results[1]).toEqual({
      id: orphan.id,
      status: 'rejected',
      reason: 'missing_parent',
    });
  });

  it('lets the newer write win and returns the stored row to the loser', async () => {
    await push('alice', [projectMutation(ids.project, '2026-11-01T10:00:00.000Z', 'New name')]);
    const result = await push('alice', [
      projectMutation(ids.project, '2026-11-01T09:00:00.000Z', 'Old name'),
    ]);

    expect(result.results[0].status).toBe('superseded');
    expect(result.results[0].serverRow.name).toBe('New name');
  });

  it('keeps a tombstone deleted', async () => {
    await push('alice', [projectMutation(ids.project, '2026-11-01T08:00:00.000Z', 'Tower A')]);
    await push('alice', [
      {
        table: 'projects',
        id: ids.project,
        op: 'delete',
        clientUpdatedAt: '2026-11-01T09:00:00.000Z',
        fields: {},
      },
    ]);
    const result = await push('alice', [
      projectMutation(ids.project, '2026-11-01T10:00:00.000Z', 'Back?'),
    ]);

    expect(result.results[0].status).toBe('superseded');
    expect(result.results[0].serverRow.deletedAt).not.toBeNull();

    const pulled = await pull('alice', 0);

    expect(pulled.changes.projects[0].deletedAt).not.toBeNull();
  });

  it('never moves a session state backwards', async () => {
    await push('alice', [projectMutation(ids.project, '2026-11-01T08:00:00.000Z', 'Tower A')]);
    await push('alice', [sessionMutation('2026-11-01T08:00:00.000Z', 'exported')]);
    // a newer edit from an offline device that still thinks the session is active
    const result = await push('alice', [sessionMutation('2026-11-01T12:00:00.000Z', 'active')]);

    expect(result.results[0].status).toBe('applied');
    const pulled = await pull('alice', 0);

    expect(pulled.changes.sessions[0].state).toBe('exported');
  });

  it('moves a session state forward even from an older write', async () => {
    await push('alice', [projectMutation(ids.project, '2026-11-01T08:00:00.000Z', 'Tower A')]);
    await push('alice', [sessionMutation('2026-11-01T12:00:00.000Z', 'active')]);
    const result = await push('alice', [sessionMutation('2026-11-01T09:00:00.000Z', 'closed')]);

    expect(result.results[0].status).toBe('applied');
    const pulled = await pull('alice', 0);

    expect(pulled.changes.sessions[0].state).toBe('closed');
  });

  it('refuses a change the role may not make (F19)', async () => {
    await push('alice', [projectMutation(ids.project, '2026-11-01T08:00:00.000Z', 'Tower A')]);
    const result = await push('bob', [
      projectMutation(ids.project, '2026-11-01T09:00:00.000Z', 'Mine now'),
    ]);

    expect(result.results[0]).toEqual({
      id: ids.project,
      status: 'rejected',
      reason: 'forbidden:project.edit',
    });
  });

  it('rejects an unknown field without failing the batch', async () => {
    const unknown = projectMutation(ids.project, '2026-11-01T08:00:00.000Z', 'Tower A');

    unknown.fields = { ...unknown.fields, color: 'red' } as typeof unknown.fields;
    const second = projectMutation(
      '77777777-7777-4777-8777-777777777777',
      '2026-11-01T08:00:00.000Z',
      'Ok',
    );
    const result = await push('alice', [unknown, second]);

    expect(result.results[0]).toEqual({
      id: ids.project,
      status: 'rejected',
      reason: 'unknown_field:color',
    });
    expect(result.results[1].status).toBe('applied');
  });

  it('rejects a row that breaks a table rule', async () => {
    await push('alice', [
      projectMutation(ids.project, '2026-11-01T08:00:00.000Z', 'Tower A'),
      locationMutation('2026-11-01T08:00:00.000Z', 'L1'),
    ]);
    const result = await push('alice', [
      locationMutation('2026-11-01T08:00:00.000Z', 'L1', '88888888-8888-4888-8888-888888888888'),
    ]);

    expect(result.results[0]).toEqual({
      id: '88888888-8888-4888-8888-888888888888',
      status: 'rejected',
      reason: 'invalid_row:23505',
    });
  });

  it('pages by rev and says when there is more', async () => {
    const mutations = [];

    for (let index = 0; index < 5; index += 1) {
      const id = `10000000-0000-4000-8000-00000000000${index}`;

      mutations.push(projectMutation(id, '2026-11-01T08:00:00.000Z', `P${index}`));
    }
    await push('alice', mutations);
    const first = await pull('alice', 0, 3);

    expect(first.changes.projects).toHaveLength(3);
    expect(first.hasMore).toBe(true);
    const second = await pull('alice', first.nextRev, 3);

    expect(second.changes.projects).toHaveLength(2);
    expect(second.hasMore).toBe(false);
  });

  it('asks for a full resync when the cursor is older than the purge', async () => {
    await push('alice', [projectMutation(ids.project, '2026-11-01T08:00:00.000Z', 'Tower A')]);
    await context.pool.query('update sync_counter set purged_through_rev = 10');
    const pulled = await pull('alice', 3);

    expect(pulled).toEqual({ resyncRequired: true });
  });

  it('answers a batch over the limit and malformed JSON with 400', async () => {
    const mutations = [];

    for (let index = 0; index < 201; index += 1) {
      mutations.push(projectMutation(ids.project, '2026-11-01T08:00:00.000Z', 'x'));
    }
    const tooMany = await context.app.inject({
      method: 'POST',
      url: ApiRoutes.SYNC_PUSH,
      headers: auth('alice'),
      payload: { mutations },
    });

    expect(tooMany.statusCode).toBe(400);

    const broken = await context.app.inject({
      method: 'POST',
      url: ApiRoutes.SYNC_PULL,
      headers: { ...auth('alice'), 'content-type': 'application/json' },
      payload: '{not json',
    });

    expect(broken.statusCode).toBe(400);
    expect(broken.json().error).toBeDefined();
  });
});
