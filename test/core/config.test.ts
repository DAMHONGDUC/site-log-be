import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/core/config.js';
import { Storage, createS3Client } from '../../src/integrations/storage.js';

const BASE = {
  DATABASE_URL: 'postgres://sitelog@localhost/sitelog',
  AWS_REGION: 'ap-southeast-1',
  S3_BUCKET: 'sitelog-dev',
};
const LOCAL_S3 = 'http://localhost:9000';
const KEY = 'projects/p/s/c.jpg';

describe('S3 endpoint', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is AWS S3 unless S3_ENDPOINT is set', () => {
    expect(loadConfig(BASE).s3Endpoint).toBeUndefined();
    expect(loadConfig({ ...BASE, S3_ENDPOINT: LOCAL_S3 }).s3Endpoint).toBe(LOCAL_S3);
  });

  it('refuses a local endpoint in production', () => {
    expect(() => loadConfig({ ...BASE, S3_ENDPOINT: LOCAL_S3, NODE_ENV: 'production' })).toThrow(
      /S3_ENDPOINT/,
    );
  });

  it('signs URLs for the local server with the bucket in the path', async () => {
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'local');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'local-secret');
    const local = new Storage(
      createS3Client({ region: BASE.AWS_REGION, endpoint: LOCAL_S3 }),
      BASE.S3_BUCKET,
      60,
    );
    const aws = new Storage(createS3Client({ region: BASE.AWS_REGION }), BASE.S3_BUCKET, 60);

    expect(await local.presignPut(KEY, 'image/jpeg')).toMatch(
      `${LOCAL_S3}/${BASE.S3_BUCKET}/${KEY}?`,
    );
    expect(await aws.presignPut(KEY, 'image/jpeg')).toMatch(
      `https://${BASE.S3_BUCKET}.s3.${BASE.AWS_REGION}.amazonaws.com/${KEY}?`,
    );
  });
});
