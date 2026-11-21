import { DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  auth,
  closeTestContext,
  createTestContext,
  ids,
  resetDatabase,
  type TestContext,
} from './helpers.js';
import { seedProject } from './sync-helpers.js';
import { beginUpload, captureKey, completeUpload, notFoundError } from './upload-helpers.js';

describe('uploads: single PUT', () => {
  let context: TestContext;
  beforeAll(async () => {
    context = await createTestContext();
  });
  afterAll(async () => {
    await closeTestContext(context);
  });
  beforeEach(async () => {
    await resetDatabase(context.pool);
    context.s3.reset();
  });

  it.each([
    `alice/${ids.project}/${ids.session}/${ids.capture}.jpg`,
    `projects/../alice/${ids.capture}.jpg`,
    `/projects/${ids.project}/${ids.session}/${ids.capture}.jpg`,
    `projects/${ids.project}/${ids.session}/${ids.capture}.exe`,
  ])('rejects the key %s', async (badKey) => {
    const response = await beginUpload(context, 1000, badKey);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_key');
  });

  it('signs a PUT URL without checksum parameters', async () => {
    const response = await beginUpload(context, 1000);
    expect(response.statusCode).toBe(200);
    expect(response.json().mode).toBe('single');
    expect(response.json().url).toContain('X-Amz-Signature');
    expect(response.json().url).not.toContain('x-amz-checksum');
    expect(response.json().url).not.toContain('x-amz-sdk-checksum');
  });

  it('completes once and answers a retry with the same body', async () => {
    context.s3.on(HeadObjectCommand).resolves({ ContentLength: 1000 });
    const begun = await beginUpload(context, 1000);
    const first = await completeUpload(context, begun.json().uploadId);
    expect(first.statusCode).toBe(200);
    expect(first.json().verificationCode).toMatch(/^[2-9A-HJKMNP-Z]{10}$/);
    expect(first.json().verified).toBe(false);

    const again = await completeUpload(context, begun.json().uploadId);
    expect(again.statusCode).toBe(200);
    expect(again.body).toBe(first.body);
  });

  it('gives two concurrent completes the same answer', async () => {
    context.s3.on(HeadObjectCommand).resolves({ ContentLength: 1000 });
    const begun = await beginUpload(context, 1000);
    const uploadId = begun.json().uploadId;
    const [a, b] = await Promise.all([
      completeUpload(context, uploadId),
      completeUpload(context, uploadId),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.body).toBe(b.body);
  });

  it('answers 404 when nothing was uploaded and 400 when the size is wrong', async () => {
    context.s3.on(HeadObjectCommand).rejects(notFoundError());
    const begun = await beginUpload(context, 1000);
    const missing = await completeUpload(context, begun.json().uploadId);
    expect(missing.statusCode).toBe(404);

    context.s3.on(HeadObjectCommand).resolves({ ContentLength: 999 });
    const wrong = await completeUpload(context, begun.json().uploadId);
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe('size_mismatch');
  });

  it('does not let another user complete my upload', async () => {
    const begun = await beginUpload(context, 1000);
    const response = await completeUpload(context, begun.json().uploadId, undefined, 'bob');
    expect(response.statusCode).toBe(404);
  });

  it('deletes the object when the upload is aborted, and an aborted upload never completes', async () => {
    context.s3.on(DeleteObjectCommand).resolves({});
    context.s3.on(HeadObjectCommand).resolves({ ContentLength: 1000 });
    const begun = await beginUpload(context, 1000);
    const uploadId = begun.json().uploadId;
    const aborted = await context.app.inject({
      method: 'DELETE',
      url: `/uploads/${uploadId}`,
      headers: auth('alice'),
    });
    expect(aborted.statusCode).toBe(200);
    expect(context.s3.commandCalls(DeleteObjectCommand)).toHaveLength(1);

    const late = await completeUpload(context, uploadId);
    expect(late.statusCode).toBe(404);
  });

  it('refuses to begin an upload in a project the caller does not reach (403)', async () => {
    const response = await beginUpload(context, 1000, captureKey, 'bob');
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('forbidden');
  });

  it('lets a Viewer of the project read but not upload (F19)', async () => {
    await seedProject(context);
    await addMember(context.pool, 'vera', 'viewer', [ids.project]);
    const read = await context.app.inject({
      method: 'POST',
      url: '/media/urls',
      headers: auth('vera'),
      payload: { keys: [captureKey] },
    });
    expect(read.statusCode).toBe(200);
    const write = await beginUpload(context, 1000, captureKey, 'vera');
    expect(write.statusCode).toBe(403);
  });

  it('signs GET URLs only for projects the caller reaches', async () => {
    const mine = await context.app.inject({
      method: 'POST',
      url: '/media/urls',
      headers: auth('alice'),
      payload: { keys: [captureKey] },
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().urls[0].url).toContain('X-Amz-Signature');

    const theirs = await context.app.inject({
      method: 'POST',
      url: '/media/urls',
      headers: auth('bob'),
      payload: { keys: [captureKey] },
    });
    expect(theirs.statusCode).toBe(403);
  });

  it('rate limits begin per user', async () => {
    const limited = await createTestContext({ UPLOAD_RATE_LIMIT_PER_MINUTE: '2' });
    const statuses: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const response = await beginUpload(limited, 10, captureKey, 'alice');
      statuses.push(response.statusCode);
    }
    await closeTestContext(limited);
    expect(statuses).toEqual([200, 200, 429]);
  });
});
