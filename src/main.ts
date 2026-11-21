import { buildApp } from './app.js';
import { createFirebaseVerifier } from './core/auth.js';
import { loadConfig } from './core/config.js';
import { createPool } from './data/pool.js';
import { LogMailer, SesMailer, type Mailer } from './integrations/mailer.js';
import { FcmSender } from './integrations/fcm.js';
import { RealtimeHub } from './modules/realtime/hub.js';
import { Storage, createS3Client } from './integrations/storage.js';
import { FAULT_TEXT } from './constants/messages/error-text.js';
import { ENV, ENV_DEFAULT } from './constants/runtime/env.js';
import { LOG } from './constants/messages/log.js';
import { SIGNAL } from './constants/platform/external.js';

// Starts the HTTP + WebSocket server.
const config = loadConfig();
if (config.firebaseServiceAccountBase64 === undefined) {
  throw new Error(FAULT_TEXT.missingEnv(ENV.firebaseServiceAccount));
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
await app.listen({ host: ENV_DEFAULT.host, port: config.port });

// docker stop sends SIGTERM: finish open requests, then close the database pool.
async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, LOG.server.shuttingDown);
  await app.close();
  await hub.stop();
  await pool.end();
}

process.once(SIGNAL.term, () => void shutdown(SIGNAL.term));
process.once(SIGNAL.interrupt, () => void shutdown(SIGNAL.interrupt));
