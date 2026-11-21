import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { makeRequireSignedIn, makeRequireUser, type TokenVerifier } from './auth.js';
import type { Config } from './config.js';
import { registerErrorHandler } from './errors.js';
import { loggerOptions } from './logger.js';
import { LogMailer, type Mailer } from './mail/mailer.js';
import type { PushSender } from './push/fcm.js';
import { RealtimeHub } from './realtime/hub.js';
import { websocketRoutes } from './realtime/ws.js';
import { accountRoutes } from './routes/account.js';
import { deviceRoutes } from './routes/devices.js';
import { healthRoutes } from './routes/health.js';
import { mediaRoutes } from './routes/media.js';
import { syncRoutes } from './routes/sync.js';
import { teamRoutes } from './routes/team.js';
import { uploadRoutes } from './routes/uploads.js';
import { verifyRoutes } from './routes/verify.js';
import type { Storage } from './storage.js';

// Everything a route needs, passed in so tests can swap Firebase and S3 for fakes.
export interface AppDeps {
  config: Config;
  pool: pg.Pool;
  tokens: TokenVerifier;
  storage: Storage;
  hub: RealtimeHub;
  // F19: invite emails; without a sender the message is only logged.
  mailer: Mailer;
  // F19: pushes sent by the API (issue assigned, re-checked, access); none in tests by default.
  push?: PushSender | undefined;
}

export async function buildApp(
  input: Omit<AppDeps, 'mailer'> & { mailer?: Mailer },
): Promise<FastifyInstance> {
  const deps: AppDeps = { ...input, mailer: input.mailer ?? new LogMailer() };
  const app = Fastify({
    logger: loggerOptions(deps.config.logLevel),
    bodyLimit: deps.config.maxRequestBytes,
    // Caddy sits in front: read the client IP from X-Forwarded-For.
    trustProxy: true,
    // FCM tokens (~160 chars) travel in the path of DELETE /devices/:token; the default limit is 100.
    routerOptions: { maxParamLength: 4096 },
  });

  registerErrorHandler(app);
  app.decorateRequest('uid', '');

  // Off by default: a route opts in with config.rateLimit (POST /uploads, GET /verify).
  await app.register(rateLimit, { global: false });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  const requireUser = makeRequireUser(deps.tokens, deps.pool);
  const requireSignedIn = makeRequireSignedIn(deps.tokens);

  healthRoutes(app, deps);
  accountRoutes(app, deps, requireSignedIn);
  teamRoutes(app, deps, requireUser, requireSignedIn);
  syncRoutes(app, deps, requireUser);
  uploadRoutes(app, deps, requireUser);
  mediaRoutes(app, deps, requireUser);
  verifyRoutes(app, deps);
  deviceRoutes(app, deps, requireUser);
  websocketRoutes(app, deps);

  return app;
}
