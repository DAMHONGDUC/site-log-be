import { GetObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  pushMessage,
  type DevicePlatform,
  type PushMessage,
  type PushOutcome,
  type PushSender,
} from '../src/push/fcm.js';
import { verifyNextUpload, type WorkerDeps } from '../src/workers/verify.js';
import { contentHash, insertCompletedUpload, objectBody } from './fixtures.js';
import {
  workerDeps,
  closeTestContext,
  createTestContext,
  ids,
  resetDatabase,
  type TestContext,
} from './helpers.js';

// Records what would go to FCM, and answers with a chosen outcome.
class FakePush implements PushSender {
  sent: PushMessage[] = [];
  outcome: PushOutcome = 'sent';
  async send(_token: string, _platform: DevicePlatform, message: PushMessage) {
    this.sent.push(message);
    return this.outcome;
  }
}

describe('push when a session is verified', () => {
  let context: TestContext;
  let push: FakePush;
  let deps: WorkerDeps;
  beforeAll(async () => {
    context = await createTestContext();
  });
  afterAll(async () => {
    await closeTestContext(context);
  });
  beforeEach(async () => {
    await resetDatabase(context.pool);
    context.s3.reset();
    context.s3.on(GetObjectCommand).callsFake(() => ({ Body: objectBody('photo bytes') }) as never);
    push = new FakePush();
    deps = workerDeps(context, push);
    await context.pool.query(
      `insert into devices (token, uid, platform) values ($1, 'alice', 'ios')`,
      ['fX3k:APA91b' + 'a'.repeat(140)],
    );
  });

  it('pushes once, after the last upload of the session', async () => {
    await insertCompletedUpload(context.pool, { sha256: contentHash, code: 'AAAAAAAAA2' });
    await insertCompletedUpload(context.pool, { sha256: contentHash, code: 'AAAAAAAAA3' });
    await verifyNextUpload(deps);
    expect(push.sent).toHaveLength(0);
    await verifyNextUpload(deps);
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]!.deepLink).toBe(`sitelog://session/${ids.session}`);
  });

  it('forgets a device FCM no longer knows', async () => {
    push.outcome = 'unregistered';
    await insertCompletedUpload(context.pool, { sha256: contentHash });
    await verifyNextUpload(deps);
    const devices = await context.pool.query('select * from devices');
    expect(devices.rows).toHaveLength(0);
  });

  it('sends only a destination and a hashed account, shaped per platform', () => {
    const message: PushMessage = {
      kind: 'uploadsVerified',
      title: 't',
      body: 'b',
      deepLink: 'sitelog://session/1',
      uid: 'alice',
    };
    const ios = pushMessage('token', 'ios', message);
    const android = pushMessage('token', 'android', message);
    expect(JSON.stringify(ios)).not.toContain('alice');
    expect(JSON.stringify(android)).not.toContain('alice');
    expect('notification' in ios).toBe(true);
    expect('notification' in android).toBe(false);
  });
});
