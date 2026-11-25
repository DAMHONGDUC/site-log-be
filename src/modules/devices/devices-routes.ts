import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyPluginAsync } from 'fastify';
import { ApiRoutes } from '../../constants/http/api-routes.js';
import { PATTERNS } from '../../constants/runtime/limits.js';
import { Schemas } from '../../core/http/schemas.js';
import { DEVICE_PLATFORMS } from '../../constants/data/enums.js';
import { LOG } from '../../constants/messages/log.js';

// The app registers its FCM token after sign-in (with the push kinds it wants) and removes it on
// sign-out (01-api §10).
export const deviceRoutes: FastifyPluginAsync = async (app) => {
  const { deps, guards } = app;
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  const devices = deps.db.repos.devices;

  const Body = Type.Object({
    token: Type.String({ pattern: PATTERNS.fcmToken }),
    platform: Type.Union(DEVICE_PLATFORMS.map((platform) => Type.Literal(platform))),
    kinds: Type.Optional(Schemas.pushKinds()),
  });

  typed.post(
    ApiRoutes.DEVICES,
    { preHandler: guards.requireUser, schema: { body: Body } },
    async (request) => {
      const { token, platform, kinds } = request.body;

      await devices.register(token, request.uid, platform, kinds ?? null);
      request.log.info({ uid: request.uid, platform }, LOG.devices.registered);

      return { registered: true };
    },
  );

  const Params = Type.Object({ token: Type.String({ pattern: PATTERNS.fcmToken }) });

  typed.delete(
    ApiRoutes.DEVICE,
    { preHandler: guards.requireUser, schema: { params: Params } },
    async (request) => {
      await devices.removeOwn(request.params.token, request.uid);
      request.log.info({ uid: request.uid }, LOG.devices.removed);

      return { removed: true };
    },
  );
};
