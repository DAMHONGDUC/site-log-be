import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from './core/config.js';
import { DURATIONS } from './constants/runtime/durations.js';
import { Database } from './data/database.js';
import { createPool } from './data/pool.js';
import { createLogger } from './core/logger.js';
import { FcmSender, type PushSender } from './integrations/fcm.js';
import { createCoreServices } from './services.js';
import { Storage, createS3Client } from './integrations/storage.js';
import { abortAbandonedUploads } from './workers/abandoned.js';
import { purgeTombstones } from './workers/purge.js';
import { verifyNextUpload, type WorkerDeps } from './workers/verify.js';

// Background jobs, in their own container next to the API: verify uploads all the time, abort
// abandoned uploads hourly, purge tombstones daily, send the "due tomorrow" pushes once a day.
const config = loadConfig();
const log = createLogger(config.logLevel);
const pool = createPool(config);
const db = new Database(pool);
const storage = new Storage(
  createS3Client({ region: config.awsRegion, endpoint: config.s3Endpoint }),
  config.s3Bucket,
  config.presignTtlSeconds,
);
let push: PushSender | undefined = undefined;
if (config.firebaseServiceAccountBase64 !== undefined) {
  push = new FcmSender(config.firebaseServiceAccountBase64);
}
const services = createCoreServices({ db, config, storage, push, log });
const deps: WorkerDeps = { pool, db, storage, services, log };

let running = true;
let lastAbandonedRun = 0;
let lastPurgeRun = 0;
let lastDueSoonDay = '';

process.once('SIGTERM', () => {
  running = false;
});
process.once('SIGINT', () => {
  running = false;
});

log.info('worker started');
while (running) {
  let didWork = false;
  try {
    didWork = await verifyNextUpload(deps);
    if (Date.now() - lastAbandonedRun > DURATIONS.abandonedCheckEveryMs) {
      await abortAbandonedUploads(deps);
      lastAbandonedRun = Date.now();
    }
    if (Date.now() - lastPurgeRun > DURATIONS.purgeEveryMs) {
      await purgeTombstones(pool, log, config.tombstoneRetentionDays);
      lastPurgeRun = Date.now();
    }
    const dueDay = services.dueSoon.dueDay(lastDueSoonDay);
    if (dueDay !== undefined) {
      lastDueSoonDay = dueDay;
      await services.dueSoon.run();
    }
  } catch (error) {
    log.error({ err: error }, 'worker: job failed');
  }
  if (!didWork) {
    await sleep(DURATIONS.workerIdleMs);
  }
}
await pool.end();
log.info('worker stopped');
