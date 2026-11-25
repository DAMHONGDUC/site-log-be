// Creates the S3_BUCKET on the local S3 server, once: npm run s3:bucket
// AWS buckets come from the CDK app (infra/), so this only runs with S3_ENDPOINT set.
import { CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { loadConfig } from '../src/core/config.js';
import { createS3Client } from '../src/integrations/storage.js';
import { SCRIPT_TEXT } from '../src/constants/messages/script-text.js';

const config = loadConfig();

if (config.s3Endpoint === undefined) {
  process.stderr.write(SCRIPT_TEXT.bucketNeedsEndpoint);
  process.exit(1);
}
const s3 = createS3Client({ region: config.awsRegion, endpoint: config.s3Endpoint });
const exists = await s3
  .send(new HeadBucketCommand({ Bucket: config.s3Bucket }))
  .then(() => true)
  .catch(() => false);

if (!exists) {
  await s3.send(new CreateBucketCommand({ Bucket: config.s3Bucket }));
}
process.stdout.write(SCRIPT_TEXT.bucketReady(config.s3Bucket, !exists, config.s3Endpoint));
