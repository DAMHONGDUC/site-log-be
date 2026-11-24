import { ApiRoutes } from '../../../src/constants/http/api-routes.js';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { insertCompletedUpload } from '../../helpers/fixtures.js';
import {
  auth,
  closeTestContext,
  createTestContext,
  ids,
  resetDatabase,
  sha,
  type TestContext,
} from '../../helpers/helpers.js';

// Collects messages and the close code of one test socket.
function watch(socket: WebSocket) {
  const messages: Record<string, unknown>[] = [];
  let closeCode: number | undefined = undefined;

  socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
  socket.on('close', (code) => {
    closeCode = code;
  });
  async function until<T>(read: () => T | undefined, ms = 3000): Promise<T> {
    const deadline = Date.now() + ms;

    while (Date.now() < deadline) {
      const value = read();

      if (value !== undefined) {
        return value;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('timed out');
  }

  return {
    next: (type: string) => until(() => messages.find((message) => message.type === type)),
    closed: () => until(() => closeCode),
  };
}

describe('/ws', () => {
  let a: TestContext;
  let b: TestContext;

  beforeAll(async () => {
    a = await createTestContext();
    b = await createTestContext();
    await a.hub.start(a.app.log);
    await b.hub.start(b.app.log);
  });
  afterAll(async () => {
    await closeTestContext(a);
    await closeTestContext(b);
  });
  beforeEach(async () => {
    await resetDatabase(a.pool);
  });

  it('sends a snapshot first, then events from another server instance', async () => {
    const doneId = await insertCompletedUpload(a.pool);
    const socket = await a.app.injectWS(ApiRoutes.WEBSOCKET);
    const events = watch(socket);

    socket.send(JSON.stringify({ type: 'auth', token: 'uid:alice' }));
    socket.send(JSON.stringify({ type: 'subscribe', sessionID: ids.session }));

    const snapshot = await events.next('snapshot');

    expect(snapshot.completed).toEqual([
      { jobID: doneId, remoteKey: expect.any(String), sha256: sha, verified: false },
    ]);

    // Complete an upload through instance b: pg_notify carries it to the socket on a.
    b.s3.on(HeadObjectCommand).resolves({ ContentLength: 1000 });
    const begun = await b.app.inject({
      method: 'POST',
      url: ApiRoutes.UPLOADS,
      headers: auth('alice'),
      payload: {
        key: `projects/${ids.project}/${ids.session}/${ids.capture}.jpg`,
        byteSize: 1000,
        contentType: 'image/jpeg',
        sha256: sha,
      },
    });

    await b.app.inject({
      method: 'POST',
      url: ApiRoutes.uploadComplete(begun.json().uploadId),
      headers: auth('alice'),
      payload: {},
    });
    const event = await events.next('jobCompleted');

    expect(event.jobID).toBe(begun.json().uploadId);
    socket.terminate();
  });

  it('answers ping with pong', async () => {
    const socket = await a.app.injectWS(ApiRoutes.WEBSOCKET);
    const events = watch(socket);

    socket.send(JSON.stringify({ type: 'auth', token: 'uid:alice' }));
    socket.send(JSON.stringify({ type: 'ping', at: 123 }));
    expect((await events.next('pong')).at).toBe(123);
    socket.terminate();
  });

  it('closes with 4003 on a session of a project the member does not reach (F19)', async () => {
    await insertCompletedUpload(a.pool, { uid: 'alice' });
    const socket = await a.app.injectWS(ApiRoutes.WEBSOCKET);
    const events = watch(socket);

    socket.send(JSON.stringify({ type: 'auth', token: 'uid:bob' }));
    socket.send(JSON.stringify({ type: 'subscribe', sessionID: ids.session }));
    expect(await events.closed()).toBe(4003);
  });

  it('closes with 4001 on a bad token', async () => {
    const socket = await a.app.injectWS(ApiRoutes.WEBSOCKET);
    const events = watch(socket);

    socket.send(JSON.stringify({ type: 'auth', token: 'revoked:alice' }));
    expect(await events.closed()).toBe(4001);
  });

  it('closes with 4000 when no auth arrives within 5 s', async () => {
    const socket = await a.app.injectWS(ApiRoutes.WEBSOCKET);
    const events = watch(socket);
    const code = await new Promise((resolve) => {
      const started = Date.now();
      const timer = setInterval(async () => {
        if (Date.now() - started > 6000) {
          clearInterval(timer);
          resolve(undefined);
        }
      }, 100);

      events.closed().catch(() => undefined);
      socket.on('close', (closeCode) => {
        clearInterval(timer);
        resolve(closeCode);
      });
    });

    expect(code).toBe(4000);
  });
});
