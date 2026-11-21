import { GetObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { abortAbandonedUploads } from '../src/workers/abandoned.js';
import { verifyNextUpload, type WorkerDeps } from '../src/workers/verify.js';
import { contentHash, insertCompletedUpload, objectBody } from './fixtures.js';
import {
  workerDeps,
  closeTestContext,
  createTestContext,
  ids,
  resetDatabase,
  sha,
  type TestContext,
} from './helpers.js';

describe('worker', () => {
  let context: TestContext;
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
    deps = workerDeps(context, undefined);
  });

  it('marks a matching object verified, then has nothing left to do', async () => {
    await insertCompletedUpload(context.pool, { sha256: contentHash });
    context.s3.on(GetObjectCommand).callsFake(() => ({ Body: objectBody('photo bytes') }) as never);

    expect(await verifyNextUpload(deps)).toBe(true);
    const row = await context.pool.query('select verify_state, verified_at from uploads');
    expect(row.rows[0].verify_state).toBe('verified');
    expect(row.rows[0].verified_at).not.toBeNull();
    expect(await verifyNextUpload(deps)).toBe(false);
  });

  it('marks a changed object as a mismatch', async () => {
    await insertCompletedUpload(context.pool, { sha256: contentHash });
    context.s3.on(GetObjectCommand).callsFake(() => ({ Body: objectBody('other bytes') }) as never);
    await verifyNextUpload(deps);
    const row = await context.pool.query('select verify_state from uploads');
    expect(row.rows[0].verify_state).toBe('mismatch');
  });

  it('aborts uploads begun more than 7 days ago', async () => {
    await context.pool.query(
      `insert into uploads (uid, object_key, sha256, byte_size, content_type, mode, created_at)
       values ('alice', $1, $2, 10, 'image/jpeg', 'single', now() - interval '8 days')`,
      [`projects/${ids.project}/${ids.session}/${ids.capture}.jpg`, sha],
    );
    expect(await abortAbandonedUploads(deps)).toBe(1);
    const row = await context.pool.query('select state from uploads');
    expect(row.rows[0].state).toBe('aborted');
  });
});
