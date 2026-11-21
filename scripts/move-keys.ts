// F19, once after the 0012 migration: npm run move-keys
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { createLogger } from '../src/logger.js';
import { Storage, createS3Client } from '../src/storage.js';
import { moveKeys } from '../src/team/move-keys.js';

const config = loadConfig();
const log = createLogger(config.logLevel);
const pool = createPool(config);
const storage = new Storage(
  createS3Client(config.awsRegion),
  config.s3Bucket,
  config.presignTtlSeconds,
);
await moveKeys(pool, storage, log);
await pool.end();
