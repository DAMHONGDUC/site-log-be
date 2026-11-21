import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import { ApiRoutes } from '../constants/api-routes.js';
import { LIMITS, PATTERNS } from '../constants/limits.js';
import type { Guards } from '../http/guards.js';
import { Schemas, rateLimit } from '../http/schemas.js';

// Presigned uploads (01-api §7); the rules live in UploadService.
export function uploadRoutes(app: FastifyInstance, deps: AppDeps, guards: Guards): void {
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
    '/uploads/:id/complete',
    { preHandler: requireUser, schema: { params: IdParams, body: CompleteBody } },
    async (request) => {
      const uid = request.uid;
      try {
        return await withTransaction(pool, async (client) => {
          const upload = await lockUpload(client, request.params.id, uid);
          if (upload === undefined || upload.state === 'aborted') {
            throw notFound('upload_not_found', 'No such upload, or it was aborted');
          }
          if (upload.state === 'completed') {
            // A retry after a lost response: same answer as the first time.
            return completedBody(upload);
          }

          if (upload.mode === 'multipart') {
            const parts = request.body.parts ?? [];
            checkParts(parts, upload.part_count!);
            try {
              await storage.completeMultipart(upload.object_key, upload.s3_upload_id!, parts);
            } catch (error) {
              // S3 may have completed it already on an earlier try whose database write failed.
              const size = await storage.head(upload.object_key);
              if (size === undefined) {
                throw error;
              }
            }
          }

          const size = await storage.head(upload.object_key);
          if (size === undefined) {
            throw notFound('object_not_found', 'Nothing was uploaded for this key');
          }
          if (size !== upload.byte_size) {
            throw badRequest('size_mismatch', `Stored ${size} bytes, expected ${upload.byte_size}`);
          }

          const code = await uniqueCode(client);
          const updated = await client.query<UploadRow>(
            `update uploads
                set state = 'completed', completed_at = now(),
                    verification_code = $2, verify_state = 'registered'
              where id = $1
          returning *`,
            [upload.id, code],
          );
          const row = updated.rows[0]!;
          await notifyUploadEvent(client, {
            uid,
            sessionId: row.session_id,
            uploadId: row.id,
            type: 'completed',
          });
          request.log.info(
            { uid, uploadId: row.id, key: row.object_key, byteSize: row.byte_size },
            'upload completed',
          );
          return completedBody(row);
        });
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          // Another upload of the same key completed first.
          const existing = await pool.query<UploadRow>(
            `select u.* from uploads u
               join uploads mine on mine.object_key = u.object_key
              where mine.id = $1 and mine.uid = $2 and u.state = 'completed'`,
            [request.params.id, uid],
          );
          if (existing.rows[0] !== undefined) {
            throw conflict(
              'already_completed',
              'This key was already uploaded',
              completedBody(existing.rows[0]),
            );
          }
        }
        throw error;
      }
    },
  );

  // 4. Abort: the user cancelled, or the app gave up. Idempotent.
  typed.delete(
    '/uploads/:id',
    { preHandler: requireUser, schema: { params: IdParams } },
    async (request) => {
      const uid = request.uid;
      return withTransaction(pool, async (client) => {
        const upload = await lockUpload(client, request.params.id, uid);
        if (upload === undefined) {
          throw notFound('upload_not_found', 'No such upload');
        }
        if (upload.state === 'completed') {
          throw conflict('already_completed', 'A completed upload cannot be aborted');
        }
        if (upload.state === 'created') {
          if (upload.mode === 'multipart') {
            await storage.abortMultipart(upload.object_key, upload.s3_upload_id!);
          } else {
            await storage.deleteObject(upload.object_key);
          }
          await client.query(`update uploads set state = 'aborted' where id = $1`, [upload.id]);
          await notifyUploadEvent(client, {
            uid,
            sessionId: upload.session_id,
            uploadId: upload.id,
            type: 'aborted',
          });
          request.log.info({ uid, uploadId: upload.id }, 'upload aborted');
        }
        return { uploadId: upload.id, aborted: true };
      });
    },
  );
}
