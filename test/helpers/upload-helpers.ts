import { ApiRoutes } from '../../src/constants/http/api-routes.js';
import { S3ServiceException } from '@aws-sdk/client-s3';
import { auth, ids, sha, type TestContext } from './helpers.js';

export const MiB = 1024 * 1024;
export const captureKey = `projects/${ids.project}/${ids.session}/${ids.capture}.jpg`;

// What the real S3 client throws for a missing object.
export function notFoundError() {
  return new S3ServiceException({
    name: 'NotFound',
    $fault: 'client',
    $metadata: { httpStatusCode: 404 },
  });
}

export async function beginUpload(
  context: TestContext,
  byteSize: number,
  key: string = captureKey,
  uid = 'alice',
) {
  return context.app.inject({
    method: 'POST',
    url: ApiRoutes.UPLOADS,
    headers: auth(uid),
    payload: { key, byteSize, contentType: 'image/jpeg', sha256: sha },
  });
}

export async function completeUpload(
  context: TestContext,
  uploadId: string,
  parts?: object[],
  uid = 'alice',
) {
  let payload: object = {};
  if (parts !== undefined) {
    payload = { parts };
  }
  return context.app.inject({
    method: 'POST',
    url: ApiRoutes.uploadComplete(uploadId),
    headers: auth(uid),
    payload,
  });
}
