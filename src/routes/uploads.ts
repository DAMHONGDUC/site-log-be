import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type pg from 'pg';
import type { AppDeps } from '../app.js';
import { newVerificationCode } from '../codes.js';
import { withTransaction } from '../db.js';
import { AppError, badRequest, conflict, notFound } from '../errors.js';
import { checkKey } from '../team/files.js';
import { notifyUploadEvent } from '../realtime/events.js';
import type { CompletedPart } from '../storage.js';

// S3 allows at most 10,000 parts per upload.
const MAX_PARTS = 10_000;

interface UploadRow {
  id: string;
  uid: string;
  object_key: string;
  project_id: string | null;
  session_id: string | null;
  sha256: string;
  byte_size: number;
  content_type: string;
  mode: 'single' | 'multipart';
  s3_upload_id: string | null;
  part_count: number | null;
  state: 'created' | 'completed' | 'aborted';
  verification_code: string | null;
  verify_state: 'registered' | 'verified' | 'mismatch' | null;
  completed_at: Date | null;
}

// The body `complete` returns. A repeated `complete` returns the same body again.
function completedBody(row: UploadRow) {
  return {
    uploadId: row.id,
    remoteKey: row.object_key,
    sha256: row.sha256,
    verificationCode: row.verification_code,
    verified: row.verify_state === 'verified',
    receivedAt: row.completed_at,
  };
}

async function lockUpload(
  client: pg.PoolClient,
  id: string,
  uid: string,
): Promise<UploadRow | undefined> {
  const result = await client.query<UploadRow>(
    'select * from uploads where id = $1 and uid = $2 for update',
    [id, uid],
  );
  return result.rows[0];
}

async function uniqueCode(client: pg.PoolClient): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newVerificationCode();
    const taken = await client.query('select 1 from uploads where verification_code = $1', [code]);
    if (taken.rows.length === 0) {
      return code;
    }
  }
  throw new Error('Could not find a free verification code');
}

// Every part number from 1 to partCount exactly once.
function checkParts(parts: CompletedPart[], partCount: number): void {
  if (parts.length !== partCount) {
    throw badRequest('invalid_parts', `Expected ${partCount} parts, got ${parts.length}`);
  }
  const seen = new Set<number>();
  for (const part of parts) {
    if (part.number < 1 || part.number > partCount || seen.has(part.number)) {
      throw badRequest('invalid_parts', `Bad or repeated part number ${part.number}`);
    }
    seen.add(part.number);
  }
}

export function uploadRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  requireUser: preHandlerAsyncHookHandler,
): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  const { config, pool, storage } = deps;

  const BeginBody = Type.Object({
    key: Type.String({ minLength: 1, maxLength: 300 }),
    byteSize: Type.Integer({ minimum: 1 }),
    contentType: Type.String({ pattern: '^[a-z]+/[a-z0-9.+-]+$' }),
    sha256: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  });

  // Per signed-in user (the token), so one runaway device cannot flood S3 with uploads.
  const beginLimit = {
    max: config.uploadRateLimitPerMinute,
    timeWindow: '1 minute',
    keyGenerator: (request: FastifyRequest) => request.headers.authorization ?? request.ip,
  };

  // 1. Begin: the backend picks single PUT or multipart from the size.
  typed.post(
    '/uploads',
    { preHandler: requireUser, schema: { body: BeginBody }, config: { rateLimit: beginLimit } },
    async (request) => {
      const { key, byteSize, contentType, sha256 } = request.body;
      const parsed = await checkKey(pool, request.member, key, 'write');
      if (byteSize > config.maxUploadBytes) {
        throw new AppError(413, 'file_too_large', 'File is larger than the upload limit');
      }

      let projectId: string | null = null;
      let sessionId: string | null = null;
      if (parsed.kind === 'capture') {
        projectId = parsed.projectId;
        sessionId = parsed.sessionId;
      } else if (parsed.kind === 'plan') {
        projectId = parsed.projectId;
      }
      const expiresAt = storage.expiresAt(new Date());

      if (byteSize < config.singlePutThresholdBytes) {
        const inserted = await pool.query<{ id: string }>(
          `insert into uploads (uid, object_key, project_id, session_id, sha256, byte_size, content_type, mode)
         values ($1, $2, $3, $4, $5, $6, $7, 'single') returning id`,
          [request.uid, key, projectId, sessionId, sha256, byteSize, contentType],
        );
        const uploadId = inserted.rows[0]!.id;
        const url = await storage.presignPut(key, contentType);
        request.log.info(
          { uid: request.uid, uploadId, key, byteSize, mode: 'single' },
          'upload begun',
        );
        return { mode: 'single', uploadId, url, expiresAt };
      }

      const partCount = Math.ceil(byteSize / config.partSizeBytes);
      if (partCount > MAX_PARTS) {
        throw new AppError(413, 'file_too_large', 'File needs more than 10,000 parts');
      }
      const s3UploadId = await storage.createMultipart(key, contentType);
      const inserted = await pool.query<{ id: string }>(
        `insert into uploads
         (uid, object_key, project_id, session_id, sha256, byte_size, content_type, mode, s3_upload_id, part_count)
       values ($1, $2, $3, $4, $5, $6, $7, 'multipart', $8, $9) returning id`,
        [
          request.uid,
          key,
          projectId,
          sessionId,
          sha256,
          byteSize,
          contentType,
          s3UploadId,
          partCount,
        ],
      );
      const uploadId = inserted.rows[0]!.id;
      const parts: { number: number; url: string }[] = [];
      for (let number = 1; number <= partCount; number += 1) {
        parts.push({ number, url: await storage.presignPart(key, s3UploadId, number) });
      }
      request.log.info(
        { uid: request.uid, uploadId, key, byteSize, partCount, mode: 'multipart' },
        'upload begun',
      );
      return { mode: 'multipart', uploadId, partSizeBytes: config.partSizeBytes, parts, expiresAt };
    },
  );

  const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
  const RefreshBody = Type.Object({
    numbers: Type.Array(Type.Integer({ minimum: 1, maximum: MAX_PARTS }), {
      minItems: 1,
      maxItems: 1000,
    }),
  });

  // 2. Fresh URLs for parts whose URLs expired (the app was killed for hours).
  typed.post(
    '/uploads/:id/parts/refresh',
    { preHandler: requireUser, schema: { params: IdParams, body: RefreshBody } },
    async (request) => {
      const result = await pool.query<UploadRow>(
        `select * from uploads where id = $1 and uid = $2 and state = 'created' and mode = 'multipart'`,
        [request.params.id, request.uid],
      );
      const upload = result.rows[0];
      if (upload === undefined) {
        throw notFound('upload_not_found', 'No open multipart upload with this id');
      }
      const parts: { number: number; url: string }[] = [];
      for (const number of request.body.numbers) {
        if (number > upload.part_count!) {
          throw badRequest('invalid_parts', `Part ${number} is past the last part`);
        }
        parts.push({
          number,
          url: await storage.presignPart(upload.object_key, upload.s3_upload_id!, number),
        });
      }
      request.log.info(
        { uid: request.uid, uploadId: upload.id, count: parts.length },
        'upload parts refreshed',
      );
      return { parts, expiresAt: storage.expiresAt(new Date()) };
    },
  );

  const CompleteBody = Type.Object({
    parts: Type.Optional(
      Type.Array(
        Type.Object({ number: Type.Integer({ minimum: 1 }), etag: Type.String({ minLength: 1 }) }),
        {
          maxItems: MAX_PARTS,
        },
      ),
    ),
  });

  // 3. Complete: confirm the object exists, record it, issue a verification code. Idempotent.
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
