import { ApiRoutes } from '../../../src/constants/http/api-routes.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertCompletedUpload } from '../../helpers/fixtures.js';
import {
  closeTestContext,
  createTestContext,
  resetDatabase,
  type TestContext,
} from '../../helpers/helpers.js';

describe('GET /verify/:code', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext({ VERIFY_RATE_LIMIT_PER_MINUTE: '5' });
  });
  afterAll(async () => {
    await closeTestContext(context);
  });
  beforeEach(async () => {
    await resetDatabase(context.pool);
  });

  it('returns facts about the file and nothing that identifies the user', async () => {
    await insertCompletedUpload(context.pool, { code: 'ABCDEFGH23' });
    const response = await context.app.inject({
      method: 'GET',
      url: ApiRoutes.verify('abcdefgh23'),
      remoteAddress: '10.0.0.1',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(Object.keys(body).sort()).toEqual(
      [
        'byteSize',
        'code',
        'projectRef',
        'receivedAt',
        'sha256',
        'verified',
        'verifiedAt',
        'verifyState',
      ].sort(),
    );
    expect(response.body).not.toContain('alice');
    expect(response.body).not.toContain('https://');
  });

  it('answers an unknown code with 404 after the same minimum delay', async () => {
    const started = Date.now();
    const response = await context.app.inject({
      method: 'GET',
      url: ApiRoutes.verify('ZZZZZZZZZZ'),
      remoteAddress: '10.0.0.2',
    });

    expect(response.statusCode).toBe(404);
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
  });

  it('rate limits one IP', async () => {
    let last = 0;

    for (let index = 0; index < 6; index += 1) {
      const response = await context.app.inject({
        method: 'GET',
        url: ApiRoutes.verify('ZZZZZZZZZZ'),
        remoteAddress: '10.0.0.3',
      });

      last = response.statusCode;
    }
    expect(last).toBe(429);
  });
});
