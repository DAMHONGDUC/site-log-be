import rateLimitPlugin from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { makeRequireSignedIn, makeRequireUser, type TokenVerifier } from './core/auth.js';
import type { Config } from './core/config.js';
import { LIMITS } from './constants/runtime/limits.js';
import { Database } from './data/database.js';
import { registerErrorHandler } from './core/errors.js';
import type { Guards } from './core/http/guards.js';
import { registerOpenApi } from './core/http/openapi.js';
import { loggerOptions } from './core/logger.js';
import { LogMailer, type Mailer } from './integrations/mailer.js';
import type { PushSender } from './integrations/fcm.js';
import type { RealtimeHub } from './modules/realtime/hub.js';
import { websocketRoutes } from './modules/realtime/websocket-routes.js';
import { accountRoutes } from './modules/account/account-routes.js';
import { deviceRoutes } from './modules/devices/devices-routes.js';
import { healthRoutes } from './modules/health/health-routes.js';
import { invitationRoutes } from './modules/team/invitations/invitations-routes.js';
import { mediaRoutes } from './modules/uploads/media/media-routes.js';
import { memberRoutes } from './modules/team/members/members-routes.js';
import { syncRoutes } from './modules/sync/sync-routes.js';
import { uploadRoutes } from './modules/uploads/transfer/uploads-routes.js';
import { verifyRoutes } from './modules/uploads/verify/verify-routes.js';
import { createServices, type Services } from './services.js';
import type { Storage } from './integrations/storage.js';
import { REQUEST_UID } from './constants/http/openapi.js';

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
  app.decorateRequest(REQUEST_UID.field, REQUEST_UID.empty);

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
