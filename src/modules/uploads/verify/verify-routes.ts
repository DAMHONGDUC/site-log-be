import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyPluginAsync } from 'fastify';
import { setTimeout as sleep } from 'node:timers/promises';
import { ApiRoutes } from '../../../constants/http/api-routes.js';
import { ErrorCode } from '../../../constants/http/error-codes.js';
import { LIMITS } from '../../../constants/runtime/limits.js';
import { TEXT_CUT } from '../../../constants/runtime/units.js';
import { notFound } from '../../../core/errors.js';
import { rateLimit } from '../../../core/http/schemas.js';
import { HTTP_HEADER } from '../../../constants/platform/external.js';
import { LOG } from '../../../constants/messages/log.js';
import { ERROR_TEXT } from '../../../constants/messages/error-text.js';
import { VERIFY_STATE } from '../../../constants/data/enums.js';

// Public: anyone holding a report can check a code printed under a photo.
// It returns facts about the file only: never the image, a URL, the uid or the location.
export const verifyRoutes: FastifyPluginAsync = async (app) => {
  const { deps } = app;
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
      reply.header(HTTP_HEADER.cacheControl, HTTP_HEADER.noStore);

      if (row === undefined) {
        request.log.info({ found: false }, LOG.uploads.verifyLookup);
        throw notFound(ErrorCode.codeNotFound, ERROR_TEXT.unknownCode);
      }
      request.log.info({ found: true, verifyState: row.verifyState }, LOG.uploads.verifyLookup);
      let projectRef: string | null = null;
      if (row.projectId !== null) {
        projectRef = row.projectId.slice(0, TEXT_CUT.projectRef).toUpperCase();
      }
      return {
        code,
        sha256: row.sha256,
        byteSize: row.byteSize,
        receivedAt: row.completedAt,
        verifyState: row.verifyState,
        verified: row.verifyState === VERIFY_STATE.verified,
        verifiedAt: row.verifiedAt,
        projectRef,
      };
    },
  );
};
