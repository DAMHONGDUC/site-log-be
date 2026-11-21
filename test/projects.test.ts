import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auth,
  closeTestContext,
  createTestContext,
  ids,
  resetDatabase,
  type TestContext,
} from './helpers.js';

// F03 has no sync yet: rows are inserted with SQL, as the push will do in F04.
describe('project tables', () => {
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

  async function insertProject(uid: string, id: string = ids.project) {
    await context.pool.query(
      `insert into projects (id, created_by, rev, client_updated_at, name, created_at)
       values ($1, $2, 1, now(), 'Tower A', now())`,
      [id, uid],
    );
  }

  async function insertLocation(uid: string, id: string, code: string) {
    await context.pool.query(
      `insert into locations (id, created_by, rev, client_updated_at, project_id, code, kind, sort_index)
       values ($1, $2, 1, now(), $3, $4, 'floor', 0)`,
      [id, uid, ids.project, code],
    );
  }

  it('rejects a second live location with the same code in a project', async () => {
    await insertProject('alice');
    await insertLocation('alice', ids.location, 'L1');
    await expect(
      insertLocation('alice', '88888888-8888-4888-8888-888888888888', 'L1'),
    ).rejects.toThrow('locations_code_live');
  });

  it('allows the code again once the first location is deleted', async () => {
    await insertProject('alice');
    await insertLocation('alice', ids.location, 'L1');
    await context.pool.query('update locations set deleted_at = now()');
    await insertLocation('alice', '88888888-8888-4888-8888-888888888888', 'L1');
  });

  it('rejects a location that points at a project that does not exist', async () => {
    await expect(insertLocation('alice', ids.location, 'L1')).rejects.toThrow('foreign key');
  });

  it('keeps project rows when the member who made them leaves (F19)', async () => {
    await insertProject('bob');
    await insertLocation('bob', ids.location, 'L1');
    const response = await context.app.inject({
      method: 'DELETE',
      url: '/account',
      headers: auth('bob'),
    });
    expect(response.statusCode).toBe(200);
    const rows = await context.pool.query('select created_by from locations');
    expect(rows.rows).toEqual([{ created_by: 'bob' }]);
  });
});
