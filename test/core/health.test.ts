import { ApiRoutes } from '../../src/constants/http/api-routes.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeTestContext, createTestContext, type TestContext } from '../helpers/helpers.js';

describe('health and error contract', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext();
  });
  afterAll(async () => {
    await closeTestContext(context);
  });

  it('answers ok when the database is reachable', async () => {
    const response = await context.app.inject({ method: 'GET', url: ApiRoutes.HEALTH });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('answers unknown routes with the error shape', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'route_not_found', message: 'No such route' },
    });
  });
});
