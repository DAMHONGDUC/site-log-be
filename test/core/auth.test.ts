import { ApiRoutes } from '../../src/constants/http/api-routes.js';
import { ListMultipartUploadsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeTestContext,
  createTestContext,
  resetDatabase,
  type TestContext,
} from '../helpers/helpers.js';

describe('requireUser', () => {
  let context: TestContext;
  beforeAll(async () => {
    context = await createTestContext();
    context.s3.on(ListObjectsV2Command).resolves({ Contents: [] });
    context.s3.on(ListMultipartUploadsCommand).resolves({ Uploads: [] });
    await resetDatabase(context.pool);
  });
  afterAll(async () => {
    await closeTestContext(context);
  });

  // Any member route works; GET /me is the simplest (F19).
  async function call(headers: Record<string, string>) {
    return context.app.inject({ method: 'GET', url: ApiRoutes.ME, headers });
  }

  it('rejects a missing token with 401', async () => {
    const response = await call({});
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('missing_token');
  });

  it('rejects a revoked token with 401, never 403', async () => {
    const response = await call({ authorization: 'Bearer revoked:alice' });
    expect(response.statusCode).toBe(401);
  });

  it('answers 503 when Firebase cannot be reached', async () => {
    const response = await call({ authorization: 'Bearer down' });
    expect(response.statusCode).toBe(503);
  });

  it('lets a member through', async () => {
    const response = await call({ authorization: 'Bearer uid:alice' });
    expect(response.statusCode).toBe(200);
  });

  it('answers 403 not_invited to someone who is not a member', async () => {
    const response = await call({ authorization: 'Bearer uid:stranger' });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('not_invited');
  });

  it('answers 401 to a removed member', async () => {
    await context.pool.query(`update members set removed_at = now() where uid = 'carol'`);
    const response = await call({ authorization: 'Bearer uid:carol' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('member_removed');
  });
});
