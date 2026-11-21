import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiRoutes } from '../../src/constants/api-routes.js';
import { closeTestContext, createTestContext, type TestContext } from '../helpers/helpers.js';

describe('openapi', () => {
  let context: TestContext;
  beforeAll(async () => {
    context = await createTestContext();
  });
  afterAll(async () => {
    await closeTestContext(context);
  });

  it('documents every HTTP route, public ones without a token', async () => {
    const response = await context.app.inject({ method: 'GET', url: `${ApiRoutes.DOCS}/json` });
    expect(response.statusCode).toBe(200);
    const document = response.json();
    expect(document.paths['/devices'].post.requestBody).toBeDefined();
    expect(document.paths['/health'].get.security).toEqual([]);
    expect(document.paths['/devices'].post.security).toBeUndefined();
    expect(document.paths[ApiRoutes.WEBSOCKET]).toBeUndefined();
  });
});
