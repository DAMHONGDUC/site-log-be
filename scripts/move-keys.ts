// F19, once after migration 0012: npm run move-keys
import { loadConfig } from '../src/config.js';
import { Database } from '../src/data/database.js';
import { createPool } from '../src/db.js';
import { createLogger } from '../src/logger.js';
import { KeyMigrationService } from '../src/services/key-migration-service.js';
import { Storage, createS3Client } from '../src/storage.js';

const config = loadConfig();
const log = createLogger(config.logLevel);
const pool = createPool(config);
const storage = new Storage(
  createS3Client(config.awsRegion),
  config.s3Bucket,
  config.presignTtlSeconds,
);
await new KeyMigrationService(new Database(pool), storage, log).run();
await pool.end();
