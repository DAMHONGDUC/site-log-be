// F19, once after migration 0012: npm run move-keys
import { loadConfig } from '../src/core/config.js';
import { Database } from '../src/data/database.js';
import { createPool } from '../src/data/pool.js';
import { createLogger } from '../src/core/logger.js';
import { KeyMigrationService } from '../src/modules/uploads/index.js';
import { Storage, createS3Client } from '../src/integrations/storage.js';

const config = loadConfig();
const log = createLogger(config.logLevel);
const pool = createPool(config);
const storage = new Storage(
  createS3Client({ region: config.awsRegion, endpoint: config.s3Endpoint }),
  config.s3Bucket,
  config.presignTtlSeconds,
);
await new KeyMigrationService(new Database(pool), storage, log).run();
await pool.end();
