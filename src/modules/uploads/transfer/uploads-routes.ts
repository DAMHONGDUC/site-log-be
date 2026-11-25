import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyPluginAsync } from 'fastify';
import { ApiRoutes } from '../../../constants/http/api-routes.js';
import { LIMITS, PATTERNS } from '../../../constants/runtime/limits.js';
import { Schemas, rateLimit } from '../../../core/http/schemas.js';

// Presigned uploads (01-api §7); the rules live in UploadService.
export const uploadRoutes: FastifyPluginAsync = async (app) => {
  const { deps, guards } = app;
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  const { uploads } = deps.services;

  const BeginBody = Type.Object({
    key: Schemas.objectKey(),
    byteSize: Type.Integer({ minimum: 1 }),
    contentType: Type.String({ pattern: PATTERNS.contentType }),
    sha256: Type.String({ pattern: PATTERNS.sha256Hex }),
  });

  typed.post(
    ApiRoutes.UPLOADS,
    {
      preHandler: guards.requireUser,
      schema: { body: BeginBody },
      config: { rateLimit: rateLimit(deps.config.uploadRateLimitPerMinute, true) },
    },
    async (request) => uploads.begin(request.member, request.body),
  );

  const RefreshBody = Type.Object({
    numbers: Type.Array(Type.Integer({ minimum: 1, maximum: LIMITS.s3MaxParts }), {
      minItems: 1,
      maxItems: LIMITS.partsPerRefresh,
    }),
  });

  typed.post(
    ApiRoutes.UPLOAD_PARTS_REFRESH,
    { preHandler: guards.requireUser, schema: { params: Schemas.idParams(), body: RefreshBody } },
    async (request) => uploads.refreshParts(request.uid, request.params.id, request.body.numbers),
  );

  const CompleteBody = Type.Object({
    parts: Type.Optional(
      Type.Array(
        Type.Object({ number: Type.Integer({ minimum: 1 }), etag: Type.String({ minLength: 1 }) }),
        { maxItems: LIMITS.s3MaxParts },
      ),
    ),
  });

  typed.post(
    ApiRoutes.UPLOAD_COMPLETE,
    { preHandler: guards.requireUser, schema: { params: Schemas.idParams(), body: CompleteBody } },
    async (request) => uploads.complete(request.uid, request.params.id, request.body.parts),
  );

  typed.delete(
    ApiRoutes.UPLOAD,
    { preHandler: guards.requireUser, schema: { params: Schemas.idParams() } },
    async (request) => uploads.abort(request.uid, request.params.id),
  );
};
