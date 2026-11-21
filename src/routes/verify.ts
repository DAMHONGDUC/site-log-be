import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import { setTimeout as sleep } from 'node:timers/promises';
import type { AppDeps } from '../app.js';
import { ApiRoutes } from '../constants/api-routes.js';
import { ErrorCode } from '../constants/error-codes.js';
import { LIMITS } from '../constants/limits.js';
import { TEXT_CUT } from '../constants/units.js';
import { notFound } from '../errors.js';
import { rateLimit } from '../http/schemas.js';

// Public: anyone holding a report can check a code printed under a photo.
// It returns facts about the file only: never the image, a URL, the uid or the location.
export function verifyRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  const Params = Type.Object({
    code: Type.String({
      minLength: LIMITS.verificationCodeMinLength,
      maxLength: LIMITS.verificationCodeMaxLength,
    }),
  });

  typed.get(
    ApiRoutes.VERIFY,
    {
      schema: { params: Params },
      config: { rateLimit: rateLimit(deps.config.verifyRateLimitPerMinute) },
    },
    async (request, reply) => {
      const started = Date.now();
      const code = request.params.code.toUpperCase();
      const row = await deps.services.uploads.findByCode(code);

      // Hits and misses take the same time, so timing does not reveal which codes exist.
      const elapsed = Date.now() - started;
      if (elapsed < deps.config.verifyMinDelayMs) {
        await sleep(deps.config.verifyMinDelayMs - elapsed);
      }
      reply.header('cache-control', 'no-store');

      if (row === undefined) {
        request.log.info({ found: false }, 'verify lookup');
        throw notFound(ErrorCode.codeNotFound, 'Unknown verification code');
      }
      request.log.info({ found: true, verifyState: row.verify_state }, 'verify lookup');
      let projectRef: string | null = null;
      if (row.project_id !== null) {
        projectRef = row.project_id.slice(0, TEXT_CUT.projectRef).toUpperCase();
      }
      return {
        code,
        sha256: row.sha256,
        byteSize: row.byte_size,
        receivedAt: row.completed_at,
        verifyState: row.verify_state,
        verified: row.verify_state === 'verified',
        verifiedAt: row.verified_at,
        projectRef,
      };
    },
  );
}
