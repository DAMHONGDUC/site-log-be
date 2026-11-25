import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiRoutes } from '../../src/constants/http/api-routes.js';
import { ERROR_CONTRACT } from '../../src/constants/http/api-guide/index.js';
import { ErrorCode } from '../../src/constants/http/error-codes.js';
import { WS_CLOSE } from '../../src/constants/runtime/websocket.js';
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

  it('has no two paths that differ only by a parameter name', async () => {
    const response = await context.app.inject({ method: 'GET', url: `${ApiRoutes.DOCS}/json` });
    const shapes = Object.keys(response.json().paths).map((path) =>
      path.replace(/\{[^}]+\}/g, '{}'),
    );

    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it('lists every error code in the guide exactly once', () => {
    const listed = ERROR_CONTRACT.flatMap(({ codes }) => [...codes]);

    expect([...listed].sort()).toEqual(Object.values(ErrorCode).sort());
  });

  it('carries the guide in the description: errors, WebSocket, flows', async () => {
    const response = await context.app.inject({ method: 'GET', url: `${ApiRoutes.DOCS}/json` });
    const description: string = response.json().info.description;

    expect(description).toContain('Error contract');
    expect(description).toContain(ErrorCode.notInvited);
    expect(description).toContain(`WebSocket \`${ApiRoutes.WEBSOCKET}\``);
    expect(description).toContain(String(WS_CLOSE.tooManySockets));
    expect(description).toContain('Flows');
    expect(description).toContain('`/uploads/{id}/complete`');
  });

  it('serves the invite preview under its own path', async () => {
    const response = await context.app.inject({ method: 'GET', url: `${ApiRoutes.DOCS}/json` });
    const paths = response.json().paths;

    expect(paths['/invitations/preview/{token}'].get.security).toEqual([]);
    expect(paths['/invitations/{id}'].get).toBeUndefined();
  });
});
