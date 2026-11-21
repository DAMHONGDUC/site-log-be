import { buildApp } from './app.js';
import { createFirebaseVerifier } from './core/auth.js';
import { loadConfig } from './core/config.js';
import { createPool } from './data/pool.js';
import { LogMailer, SesMailer, type Mailer } from './integrations/mailer.js';
import { FcmSender } from './integrations/fcm.js';
import { RealtimeHub } from './modules/realtime/hub.js';
import { Storage, createS3Client } from './integrations/storage.js';

// Starts the HTTP + WebSocket server.
const config = loadConfig();
if (config.firebaseServiceAccountBase64 === undefined) {
  throw new Error('Missing environment variable FIREBASE_SERVICE_ACCOUNT_BASE64');
}

const pool = createPool(config);
const tokens = createFirebaseVerifier(config.firebaseServiceAccountBase64);
const storage = new Storage(
  createS3Client({ region: config.awsRegion, endpoint: config.s3Endpoint }),
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
