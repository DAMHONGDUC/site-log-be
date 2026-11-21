import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createLogger } from './logger.js';
import { FcmSender, type PushSender } from './push/fcm.js';
import { Storage, createS3Client } from './storage.js';
import { abortAbandonedUploads } from './workers/abandoned.js';
import { dueSoonIsDue, pushDueSoon } from './workers/due-soon.js';
import { purgeTombstones } from './workers/purge.js';
import { verifyNextUpload, type WorkerDeps } from './workers/verify.js';

// Background jobs, in their own container next to the API:
// verify uploads all the time, abort abandoned uploads hourly, purge tombstones daily.
const config = loadConfig();
const log = createLogger(config.logLevel);
const pool = createPool(config);
const storage = new Storage(
  createS3Client(config.awsRegion),
  config.s3Bucket,
  config.presignTtlSeconds,
);
let push: PushSender | undefined = undefined;
if (config.firebaseServiceAccountBase64 !== undefined) {
  push = new FcmSender(config.firebaseServiceAccountBase64);
}
const deps: WorkerDeps = { pool, storage, push, log };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
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
    if (Date.now() - lastAbandonedRun > HOUR) {
      await abortAbandonedUploads(deps);
      lastAbandonedRun = Date.now();
    }
    if (Date.now() - lastPurgeRun > DAY) {
      await purgeTombstones(pool, log, config.tombstoneRetentionDays);
      lastPurgeRun = Date.now();
    }
    // F19: the 8:00 "due tomorrow" pushes, once a day in the site time zone.
    const dueDay = dueSoonIsDue(lastDueSoonDay, config.siteTimeZone);
    if (dueDay !== undefined) {
      lastDueSoonDay = dueDay;
      await pushDueSoon(deps, config.siteTimeZone);
    }
  } catch (error) {
    log.error({ err: error }, 'worker: job failed');
  }
  if (!didWork) {
    await sleep(5000);
  }
}
await pool.end();
log.info('worker stopped');
