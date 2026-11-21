import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import { setTimeout as sleep } from 'node:timers/promises';
import type { AppDeps } from '../app.js';
import { notFound } from '../errors.js';

interface VerifyRow {
  sha256: string;
  byte_size: number;
  completed_at: Date;
  verify_state: 'registered' | 'verified' | 'mismatch';
  verified_at: Date | null;
  project_id: string | null;
}

// Public: anyone holding a report can check a code printed under a photo.
// It returns facts about the file only: never the image, a URL, the uid or the location.
export function verifyRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  const Params = Type.Object({ code: Type.String({ minLength: 10, maxLength: 16 }) });

  typed.get(
    '/verify/:code',
    {
      schema: { params: Params },
      config: { rateLimit: { max: deps.config.verifyRateLimitPerMinute, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const started = Date.now();
      const code = request.params.code.toUpperCase();
      const result = await deps.pool.query<VerifyRow>(
        `select sha256, byte_size, completed_at, verify_state, verified_at, project_id
           from uploads where verification_code = $1 and state = 'completed'`,
        [code],
      );

      // Hits and misses take the same time, so timing does not reveal which codes exist.
      const elapsed = Date.now() - started;
      if (elapsed < deps.config.verifyMinDelayMs) {
        await sleep(deps.config.verifyMinDelayMs - elapsed);
      }
      reply.header('cache-control', 'no-store');

      const row = result.rows[0];
      if (row === undefined) {
        request.log.info({ found: false }, 'verify lookup');
        throw notFound('code_not_found', 'Unknown verification code');
      }
      request.log.info({ found: true, verifyState: row.verify_state }, 'verify lookup');
      let projectRef: string | null = null;
      if (row.project_id !== null) {
        projectRef = row.project_id.slice(0, 8).toUpperCase();
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
