import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { AppDeps } from '../app.js';
import { PUSH_KINDS } from '../push/fcm.js';

// An FCM token: letters, digits, '_', '-' and ':'.
const TOKEN_PATTERN = '^[A-Za-z0-9_:-]{20,4096}$';

// The app registers its FCM token after sign-in and removes it on sign-out.
export function deviceRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  requireUser: preHandlerAsyncHookHandler,
): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  const Body = Type.Object({
    token: Type.String({ pattern: TOKEN_PATTERN }),
    platform: Type.Union([Type.Literal('ios'), Type.Literal('android')]),
    // F19: the push kinds this device wants; missing = all.
    kinds: Type.Optional(
      Type.Array(Type.Union(PUSH_KINDS.map((kind) => Type.Literal(kind))), { maxItems: 10 }),
    ),
  });

  typed.post('/devices', { preHandler: requireUser, schema: { body: Body } }, async (request) => {
    // A token moves to whoever signed in last on that phone.
    await deps.pool.query(
      `insert into devices (token, uid, platform, kinds) values ($1, $2, $3, $4)
       on conflict (token) do update
         set uid = excluded.uid, platform = excluded.platform, kinds = excluded.kinds, updated_at = now()`,
      [request.body.token, request.uid, request.body.platform, request.body.kinds ?? null],
    );
    request.log.info({ uid: request.uid, platform: request.body.platform }, 'device registered');
    return { registered: true };
  });

  const Params = Type.Object({ token: Type.String({ pattern: TOKEN_PATTERN }) });

  typed.delete(
    '/devices/:token',
    { preHandler: requireUser, schema: { params: Params } },
    async (request) => {
      await deps.pool.query('delete from devices where token = $1 and uid = $2', [
        request.params.token,
        request.uid,
      ]);
      request.log.info({ uid: request.uid }, 'device removed');
      return { removed: true };
    },
  );
}
