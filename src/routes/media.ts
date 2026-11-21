import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { AppDeps } from '../app.js';
import { checkKey } from '../team/files.js';

// A second device shows a photo it pulled: it asks for short-lived GET URLs for the keys.
export function mediaRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  requireUser: preHandlerAsyncHookHandler,
): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  const Body = Type.Object({
    keys: Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { minItems: 1, maxItems: 200 }),
  });

  typed.post(
    '/media/urls',
    { preHandler: requireUser, schema: { body: Body } },
    async (request) => {
      const urls: { key: string; url: string }[] = [];
      for (const key of request.body.keys) {
        await checkKey(deps.pool, request.member, key, 'read');
        urls.push({ key, url: await deps.storage.presignGet(key) });
      }
      request.log.info({ uid: request.uid, count: urls.length }, 'media urls signed');
      return { urls, expiresAt: deps.storage.expiresAt(new Date()) };
    },
  );
}
