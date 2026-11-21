import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.js';
import { ApiRoutes } from '../../constants/api-routes.js';
import { LIMITS } from '../../constants/limits.js';
import type { Guards } from '../../core/http/guards.js';
import { Schemas } from '../../core/http/schemas.js';

// A device shows a photo it pulled: short-lived GET URLs for keys in projects it reaches.
export function mediaRoutes(app: FastifyInstance, deps: AppDeps, guards: Guards): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  const Body = Type.Object({
    keys: Type.Array(Schemas.objectKey(), { minItems: 1, maxItems: LIMITS.mediaKeysPerRequest }),
  });

  typed.post(
    ApiRoutes.MEDIA_URLS,
    { preHandler: guards.requireUser, schema: { body: Body } },
    async (request) => {
      const urls: { key: string; url: string }[] = [];
      for (const key of request.body.keys) {
        await deps.services.files.check(request.member, key, 'read');
        urls.push({ key, url: await deps.storage.presignGet(key) });
      }
      request.log.info({ uid: request.uid, count: urls.length }, 'media urls signed');
      return { urls, expiresAt: deps.storage.expiresAt(new Date()) };
    },
  );
}
