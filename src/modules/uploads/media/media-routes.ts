import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyPluginAsync } from 'fastify';
import { ApiRoutes } from '../../../constants/http/api-routes.js';
import { LIMITS } from '../../../constants/runtime/limits.js';
import { Schemas } from '../../../core/http/schemas.js';
import { FILE_ACCESS } from '../../../constants/domain/team.js';
import { LOG } from '../../../constants/messages/log.js';

// A device shows a photo it pulled: short-lived GET URLs for keys in projects it reaches.
export const mediaRoutes: FastifyPluginAsync = async (app) => {
  const { deps, guards } = app;
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
        await deps.services.files.check(request.member, key, FILE_ACCESS.read);
        urls.push({ key, url: await deps.storage.presignGet(key) });
      }
      request.log.info({ uid: request.uid, count: urls.length }, LOG.uploads.mediaSigned);

      return { urls, expiresAt: deps.storage.expiresAt(new Date()) };
    },
  );
};
