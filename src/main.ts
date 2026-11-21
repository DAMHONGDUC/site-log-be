import { buildApp } from './app.js';
import { createFirebaseVerifier } from './auth.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { LogMailer, SesMailer, type Mailer } from './mail/mailer.js';
import { FcmSender } from './push/fcm.js';
import { RealtimeHub } from './realtime/hub.js';
import { Storage, createS3Client } from './storage.js';

// Starts the HTTP + WebSocket server.
const config = loadConfig();
if (config.firebaseServiceAccountBase64 === undefined) {
  throw new Error('Missing environment variable FIREBASE_SERVICE_ACCOUNT_BASE64');
}

const pool = createPool(config);
const tokens = createFirebaseVerifier(config.firebaseServiceAccountBase64);
const storage = new Storage(
  createS3Client(config.awsRegion),
  config.s3Bucket,
  config.presignTtlSeconds,
);
const hub = new RealtimeHub(config, pool);
// F19: invite emails through Amazon SES when a sender is set; otherwise only logged.
let mailer: Mailer = new LogMailer();
if (config.inviteFromEmail !== undefined) {
  mailer = new SesMailer(config.awsRegion, config.inviteFromEmail);
}
const push = new FcmSender(config.firebaseServiceAccountBase64);
const app = await buildApp({ config, pool, tokens, storage, hub, mailer, push });

await hub.start(app.log);
await app.listen({ host: '0.0.0.0', port: config.port });

// docker stop sends SIGTERM: finish open requests, then close the database pool.
async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await hub.stop();
  await pool.end();
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
