import rateLimitPlugin from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { makeRequireSignedIn, makeRequireUser, type TokenVerifier } from './auth.js';
import type { Config } from './config.js';
import { LIMITS } from './constants/limits.js';
import { Database } from './data/database.js';
import { registerErrorHandler } from './errors.js';
import type { Guards } from './http/guards.js';
import { registerOpenApi } from './http/openapi.js';
import { loggerOptions } from './logger.js';
import { LogMailer, type Mailer } from './mail/mailer.js';
import type { PushSender } from './push/fcm.js';
import type { RealtimeHub } from './realtime/hub.js';
import { websocketRoutes } from './realtime/ws.js';
import { accountRoutes } from './routes/account.js';
import { deviceRoutes } from './routes/devices.js';
import { healthRoutes } from './routes/health.js';
import { invitationRoutes } from './routes/invitations.js';
import { mediaRoutes } from './routes/media.js';
import { memberRoutes } from './routes/members.js';
import { syncRoutes } from './routes/sync.js';
import { uploadRoutes } from './routes/uploads.js';
import { verifyRoutes } from './routes/verify.js';
import { createServices, type Services } from './services/index.js';
import type { Storage } from './storage.js';

// FCM tokens (~160 chars) travel in the path of DELETE /devices/:token; Fastify's default is 100.
const MAX_PARAM_LENGTH = 4096;

// What the entry point (or a test) provides.
export interface AppInput {
  config: Config;
  pool: pg.Pool;
  tokens: TokenVerifier;
  storage: Storage;
  hub: RealtimeHub;
  // F19: invite emails; without a sender they are only logged.
  mailer?: Mailer | undefined;
  // F19: pushes sent by the API (issue assigned, re-checked, access).
  push?: PushSender | undefined;
}

// Everything a route needs, built once in buildApp (the composition root).
export interface AppDeps extends AppInput {
  mailer: Mailer;
  db: Database;
  services: Services;
}

export async function buildApp(input: AppInput): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(input.config.logLevel),
    bodyLimit: input.config.maxRequestBytes,
    // Caddy sits in front: read the client IP from X-Forwarded-For.
    trustProxy: true,
    routerOptions: { maxParamLength: MAX_PARAM_LENGTH },
  });

  const db = new Database(input.pool);
  const mailer = input.mailer ?? new LogMailer(app.log);
  const services = createServices({
    db,
    config: input.config,
    storage: input.storage,
    push: input.push,
    log: app.log,
    tokens: input.tokens,
    mailer,
  });
  const deps: AppDeps = { ...input, mailer, db, services };

  registerErrorHandler(app);
  app.decorateRequest('uid', '');

  // Before any route, so every schema lands in the document.
  await registerOpenApi(app, input.config);
  // Off by default: a route opts in with config.rateLimit.
  await app.register(rateLimitPlugin, { global: false });
  await app.register(websocket, { options: { maxPayload: LIMITS.websocketMaxPayloadBytes } });

  const guards: Guards = {
    requireUser: makeRequireUser(input.tokens, services.access),
    requireSignedIn: makeRequireSignedIn(input.tokens),
  };

  healthRoutes(app, deps);
  accountRoutes(app, deps, guards);
  memberRoutes(app, deps, guards);
  invitationRoutes(app, deps, guards);
  syncRoutes(app, deps, guards);
  uploadRoutes(app, deps, guards);
  mediaRoutes(app, deps, guards);
  verifyRoutes(app, deps);
  deviceRoutes(app, deps, guards);
  websocketRoutes(app, deps);

  return app;
}
