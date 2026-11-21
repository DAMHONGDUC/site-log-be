import { S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { buildApp } from '../../src/app.js';
import { TokenRejectedError, type TokenVerifier } from '../../src/core/auth.js';
import { loadConfig, type Config } from '../../src/core/config.js';
import { LogMailer } from '../../src/integrations/mailer.js';
import type { DevicePlatform, PushMessage, PushSender } from '../../src/integrations/fcm.js';
import { RealtimeHub } from '../../src/modules/realtime/hub.js';
import { Database } from '../../src/data/database.js';
import { SERVER_TABLES } from '../../src/data/schema.js';
import { createLogger } from '../../src/core/logger.js';
import { createCoreServices } from '../../src/services.js';
import type { WorkerDeps } from '../../src/workers/verify.js';
import { Storage } from '../../src/integrations/storage.js';
import { syncTables } from '../../src/modules/sync/tables.js';
import { testDatabaseUrl } from './global-setup.js';

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    DATABASE_URL: testDatabaseUrl,
    AWS_REGION: 'ap-southeast-1',
    S3_BUCKET: 'sitelog-test',
    LOG_LEVEL: 'silent',
    VERIFY_MIN_DELAY_MS: '50',
    ...overrides,
  });
}

// Fake Firebase. Tokens are plain text: "uid:alice" is alice (email alice@test.dev),
// "uid:alice|other@x.dev" signs in with another email, "revoked:alice" is rejected,
// "down" means Firebase is unreachable.
export class FakeTokens implements TokenVerifier {
  deletedUsers: string[] = [];
  revokedUsers: string[] = [];

  async revoke(uid: string) {
    this.revokedUsers.push(uid);
  }

  async verify(token: string) {
    if (token === 'down') {
      throw new Error('firebase unreachable');
    }
    if (token.startsWith('uid:')) {
      const [uid = '', email] = token.slice(4).split('|');
      return {
        uid,
        email: email ?? `${uid}@test.dev`,
        expiresAt: new Date(Date.now() + 3600_000),
      };
    }
    throw new TokenRejectedError('auth/id-token-revoked');
  }

  async deleteUser(uid: string) {
    this.deletedUsers.push(uid);
  }
}

export interface TestContext {
  app: FastifyInstance;
  pool: pg.Pool;
  s3: ReturnType<typeof mockClient>;
  tokens: FakeTokens;
  hub: RealtimeHub;
  storage: Storage;
  config: Config;
  mailer: LogMailer;
  push: FakePush;
}

// Records every push instead of sending it.
export class FakePush implements PushSender {
  sent: { token: string; platform: DevicePlatform; message: PushMessage }[] = [];
  async send(token: string, platform: DevicePlatform, message: PushMessage) {
    this.sent.push({ token, platform, message });
    return 'sent' as const;
  }
}

export async function createTestContext(
  overrides: Record<string, string> = {},
): Promise<TestContext> {
  const config = testConfig(overrides);
  const pool = new pg.Pool({ connectionString: config.databaseUrl, options: '-c TimeZone=UTC' });
  // A real S3 client with fake keys: presigning works offline, every call is mocked.
  const client = new S3Client({
    region: config.awsRegion,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
  const s3 = mockClient(client);
  const storage = new Storage(client, config.s3Bucket, config.presignTtlSeconds);
  const tokens = new FakeTokens();
  const hub = new RealtimeHub(config, pool);
  const mailer = new LogMailer();
  const push = new FakePush();
  const app = await buildApp({ config, pool, tokens, storage, hub, mailer, push });
  await app.ready();
  return { app, pool, s3, tokens, hub, storage, config, mailer, push };
}

export async function closeTestContext(context: TestContext): Promise<void> {
  await context.app.close();
  await context.hub.stop();
  await context.pool.end();
}

// Empties every table the app writes, so each test starts clean, then adds the test team:
// alice is the Admin; bob and carol are Inspectors on no project yet.
export async function resetDatabase(pool: pg.Pool): Promise<void> {
  const tables = [...syncTables.map((table) => table.name), ...SERVER_TABLES];
  await pool.query(`truncate ${tables.join(', ')} restart identity`);
  await pool.query('update sync_counter set last_rev = 0, purged_through_rev = 0');
  await addMember(pool, 'alice', 'admin');
  await addMember(pool, 'bob', 'inspector');
  await addMember(pool, 'carol', 'inspector');
}

export async function addMember(
  pool: pg.Pool,
  uid: string,
  role: 'admin' | 'manager' | 'inspector' | 'viewer',
  projectIds: string[] = [],
): Promise<void> {
  await pool.query(
    `insert into members (uid, email, name, role) values ($1, $2, $3, $4)
     on conflict (uid) do update set role = excluded.role, removed_at = null`,
    [uid, `${uid}@test.dev`, uid[0]!.toUpperCase() + uid.slice(1), role],
  );
  for (const projectId of projectIds) {
    await pool.query(
      'insert into project_members (project_id, uid) values ($1, $2) on conflict do nothing',
      [projectId, uid],
    );
  }
}

export function auth(uid: string): Record<string, string> {
  return { authorization: `Bearer uid:${uid}` };
}

export const ids = {
  project: '11111111-1111-4111-8111-111111111111',
  location: '22222222-2222-4222-8222-222222222222',
  session: '33333333-3333-4333-8333-333333333333',
  capture: '44444444-4444-4444-8444-444444444444',
};

export const sha = 'a'.repeat(64);

// What the worker jobs get, with a push sender of the test's choice.
export function workerDeps(context: TestContext, push: PushSender | undefined): WorkerDeps {
  const db = new Database(context.pool);
  const log = createLogger('silent');
  const services = createCoreServices({
    db,
    config: context.config,
    storage: context.storage,
    push,
    log,
  });
  return { pool: context.pool, db, storage: context.storage, services, log };
}
