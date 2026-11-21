import { ApiRoutes } from '../src/constants/api-routes.js';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auth,
  closeTestContext,
  createTestContext,
  resetDatabase,
  type TestContext,
} from './helpers.js';
import { MiB, beginUpload, completeUpload } from './upload-helpers.js';

describe('uploads: multipart', () => {
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
    context.s3.on(CreateMultipartUploadCommand).resolves({ UploadId: 's3-upload-1' });
  });

  it('picks single PUT below 5 MiB and 8 MiB parts from 5 MiB', async () => {
    const below = await beginUpload(context, 5 * MiB - 1);
    expect(below.json().mode).toBe('single');

    const at = await beginUpload(context, 5 * MiB);
    expect(at.json().mode).toBe('multipart');
    expect(at.json().partSizeBytes).toBe(8 * MiB);
    expect(at.json().parts).toHaveLength(1);

    const big = await beginUpload(context, 240 * MiB);
    expect(big.json().parts).toHaveLength(30);
  });

  it('completes only with every part, and passes the ETags to S3', async () => {
    context.s3.on(CompleteMultipartUploadCommand).resolves({});
    context.s3.on(HeadObjectCommand).resolves({ ContentLength: 20 * MiB });
    const begun = await beginUpload(context, 20 * MiB);
    const uploadId = begun.json().uploadId;

    const missingPart = await completeUpload(context, uploadId, [{ number: 1, etag: '"a"' }]);
    expect(missingPart.statusCode).toBe(400);

    const done = await completeUpload(context, uploadId, [
      { number: 3, etag: '"c"' },
      { number: 1, etag: '"a"' },
      { number: 2, etag: '"b"' },
    ]);
    expect(done.statusCode).toBe(200);
    const sent = context.s3.commandCalls(CompleteMultipartUploadCommand)[0]!.args[0].input;
    expect(sent.UploadId).toBe('s3-upload-1');
    expect(sent.MultipartUpload!.Parts!.map((part) => part.PartNumber)).toEqual([1, 2, 3]);
  });

  it('refreshes exactly the requested parts, for the owner only', async () => {
    const begun = await beginUpload(context, 40 * MiB);
    const url = ApiRoutes.uploadPartsRefresh(begun.json().uploadId);
    const response = await context.app.inject({
      method: 'POST',
      url,
      headers: auth('alice'),
      payload: { numbers: [2, 5] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().parts.map((part: { number: number }) => part.number)).toEqual([2, 5]);
    expect(response.json().parts[0].url).toContain('partNumber=2');

    const past = await context.app.inject({
      method: 'POST',
      url,
      headers: auth('alice'),
      payload: { numbers: [6] },
    });
    expect(past.statusCode).toBe(400);

    const theirs = await context.app.inject({
      method: 'POST',
      url,
      headers: auth('bob'),
      payload: { numbers: [1] },
    });
    expect(theirs.statusCode).toBe(404);
  });

  it('aborts in S3, stays aborted, and never completes', async () => {
    context.s3.on(AbortMultipartUploadCommand).resolves({});
    const begun = await beginUpload(context, 40 * MiB);
    const uploadId = begun.json().uploadId;
    const aborted = await context.app.inject({
      method: 'DELETE',
      url: ApiRoutes.upload(uploadId),
      headers: auth('alice'),
    });
    expect(aborted.statusCode).toBe(200);
    expect(context.s3.commandCalls(AbortMultipartUploadCommand)).toHaveLength(1);

    const again = await context.app.inject({
      method: 'DELETE',
      url: ApiRoutes.upload(uploadId),
      headers: auth('alice'),
    });
    expect(again.statusCode).toBe(200);

    const late = await completeUpload(context, uploadId, []);
    expect(late.statusCode).toBe(404);
  });
});
