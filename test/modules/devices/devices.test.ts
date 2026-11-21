import { ApiRoutes } from '../../../src/constants/api-routes.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auth,
  closeTestContext,
  createTestContext,
  resetDatabase,
  type TestContext,
} from '../../helpers/helpers.js';

describe('devices', () => {
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

  const token = 'fX3k:APA91b' + 'a'.repeat(140);

  it('moves a token to whoever registered it last', async () => {
    for (const uid of ['alice', 'bob']) {
      const response = await context.app.inject({
        method: 'POST',
        url: ApiRoutes.DEVICES,
        headers: auth(uid),
        payload: { token, platform: 'ios' },
      });
      expect(response.statusCode).toBe(200);
    }
    const rows = await context.pool.query('select uid from devices');
    expect(rows.rows).toEqual([{ uid: 'bob' }]);
  });

  it('removes a token on sign-out', async () => {
    await context.app.inject({
      method: 'POST',
      url: ApiRoutes.DEVICES,
      headers: auth('alice'),
      payload: { token, platform: 'android' },
    });
    await context.app.inject({
      method: 'DELETE',
      url: ApiRoutes.device(token),
      headers: auth('alice'),
    });
    const rows = await context.pool.query('select * from devices');
    expect(rows.rows).toHaveLength(0);
  });
});
