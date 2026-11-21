import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.js';
import { ApiRoutes } from '../../constants/api-routes.js';
import { PATTERNS } from '../../constants/limits.js';
import type { Guards } from '../../core/http/guards.js';
import { Schemas } from '../../core/http/schemas.js';

// The app registers its FCM token after sign-in (with the push kinds it wants) and removes it on
// sign-out (01-api §10).
export function deviceRoutes(app: FastifyInstance, deps: AppDeps, guards: Guards): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  const devices = deps.db.repos.devices;

  const Body = Type.Object({
    token: Type.String({ pattern: PATTERNS.fcmToken }),
    platform: Type.Union([Type.Literal('ios'), Type.Literal('android')]),
    kinds: Type.Optional(Schemas.pushKinds()),
  });
  typed.post(
    ApiRoutes.DEVICES,
    { preHandler: guards.requireUser, schema: { body: Body } },
    async (request) => {
      const { token, platform, kinds } = request.body;
      await devices.register(token, request.uid, platform, kinds ?? null);
      request.log.info({ uid: request.uid, platform }, 'device registered');
      return { registered: true };
    },
  );

  const Params = Type.Object({ token: Type.String({ pattern: PATTERNS.fcmToken }) });
  typed.delete(
    ApiRoutes.DEVICE,
    { preHandler: guards.requireUser, schema: { params: Params } },
    async (request) => {
      await devices.removeOwn(request.params.token, request.uid);
      request.log.info({ uid: request.uid }, 'device removed');
      return { removed: true };
    },
  );
}
