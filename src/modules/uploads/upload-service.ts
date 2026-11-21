import { newVerificationCode } from './verification-code.js';
import type { Config } from '../../core/config.js';
import { ErrorCode } from '../../constants/error-codes.js';
import { HTTP_STATUS } from '../../constants/http-status.js';
import { LIMITS } from '../../constants/limits.js';
import type { Database } from '../../data/database.js';
import type { Log } from '../../core/log.js';
import type { Member } from '../team/member.js';
import { AppError, badRequest, conflict, notFound } from '../../core/errors.js';
import { notifyUploadEvent } from '../realtime/events.js';
import type { Repositories } from '../../data/repositories.js';
import type { UploadRow } from './upload-repository.js';
import type { CompletedPart, Storage } from '../../integrations/storage.js';
import type { FileAccessService } from './file-access-service.js';

const CODE_ATTEMPTS = 5;
const PG_UNIQUE_VIOLATION = '23505';

export interface BeginInput {
  key: string;
  byteSize: number;
  contentType: string;
  sha256: string;
}

// The body `complete` returns. A repeated `complete` returns the same body again.
export function completedBody(row: UploadRow) {
  return {
    uploadId: row.id,
    remoteKey: row.object_key,
    sha256: row.sha256,
    verificationCode: row.verification_code,
    verified: row.verify_state === 'verified',
    receivedAt: row.completed_at,
  };
}

// Every part number from 1 to partCount exactly once.
function checkParts(parts: CompletedPart[], partCount: number): void {
  if (parts.length !== partCount) {
    throw badRequest(ErrorCode.invalidParts, `Expected ${partCount} parts, got ${parts.length}`);
  }
  const seen = new Set<number>();
  for (const part of parts) {
    if (part.number < 1 || part.number > partCount || seen.has(part.number)) {
      throw badRequest(ErrorCode.invalidParts, `Bad or repeated part number ${part.number}`);
    }
    seen.add(part.number);
  }
}

// Presigned uploads (01-api §7): begin, refresh parts, complete, abort.
export class UploadService {
  constructor(
    private readonly db: Database,
    private readonly storage: Storage,
    private readonly files: FileAccessService,
    private readonly config: Pick<
      Config,
      'maxUploadBytes' | 'singlePutThresholdBytes' | 'partSizeBytes'
    >,
    private readonly log: Log,
  ) {}

  // The backend picks single PUT or multipart from the size.
  async begin(member: Member, input: BeginInput) {
    const parsed = await this.files.check(member, input.key, 'write');
    if (input.byteSize > this.config.maxUploadBytes) {
      throw new AppError(
        HTTP_STATUS.payloadTooLarge,
        ErrorCode.fileTooLarge,
        'File is larger than the upload limit',
      );
    }
    const projectId = parsed.kind === 'branding' ? null : parsed.projectId;
    const sessionId = parsed.kind === 'capture' ? parsed.sessionId : null;
    const expiresAt = this.storage.expiresAt(new Date());
    const base = {
      uid: member.uid,
      objectKey: input.key,
      projectId,
      sessionId,
      sha256: input.sha256,
      byteSize: input.byteSize,
      contentType: input.contentType,
    };

    if (input.byteSize < this.config.singlePutThresholdBytes) {
      const uploadId = await this.db.repos.uploads.create({
        ...base,
        mode: 'single',
        s3UploadId: null,
        partCount: null,
      });
      const url = await this.storage.presignPut(input.key, input.contentType);
      this.log.info({ uid: member.uid, uploadId, key: input.key, mode: 'single' }, 'upload begun');
      return { mode: 'single' as const, uploadId, url, expiresAt };
    }

    const partCount = Math.ceil(input.byteSize / this.config.partSizeBytes);
    if (partCount > LIMITS.s3MaxParts) {
      throw new AppError(
        HTTP_STATUS.payloadTooLarge,
        ErrorCode.fileTooLarge,
        `File needs more than ${LIMITS.s3MaxParts} parts`,
      );
    }
    const s3UploadId = await this.storage.createMultipart(input.key, input.contentType);
    const uploadId = await this.db.repos.uploads.create({
      ...base,
      mode: 'multipart',
      s3UploadId,
      partCount,
    });
    const parts: { number: number; url: string }[] = [];
    for (let number = 1; number <= partCount; number += 1) {
      parts.push({ number, url: await this.storage.presignPart(input.key, s3UploadId, number) });
    }
    this.log.info({ uid: member.uid, uploadId, partCount, mode: 'multipart' }, 'upload begun');
    return {
      mode: 'multipart' as const,
      uploadId,
      partSizeBytes: this.config.partSizeBytes,
      parts,
      expiresAt,
    };
  }

  // Fresh URLs for parts whose URLs expired (the app was killed for hours).
  async refreshParts(uid: string, id: string, numbers: number[]) {
    const upload = await this.db.repos.uploads.findOpenMultipart(id, uid);
    if (upload === undefined) {
      throw notFound(ErrorCode.uploadNotFound, 'No open multipart upload with this id');
    }
    const parts: { number: number; url: string }[] = [];
    for (const number of numbers) {
      if (number > upload.part_count!) {
        throw badRequest(ErrorCode.invalidParts, `Part ${number} is past the last part`);
      }
      parts.push({
        number,
        url: await this.storage.presignPart(upload.object_key, upload.s3_upload_id!, number),
      });
    }
    this.log.info({ uid, uploadId: upload.id, count: parts.length }, 'upload parts refreshed');
    return { parts, expiresAt: this.storage.expiresAt(new Date()) };
  }

  // Confirms the object exists, records it, issues a verification code. Idempotent.
  async complete(uid: string, id: string, parts: CompletedPart[] | undefined) {
    try {
      return await this.db.transaction(async (repos, client) => {
        const upload = await repos.uploads.lockOwn(id, uid);
        if (upload === undefined || upload.state === 'aborted') {
          throw notFound(ErrorCode.uploadNotFound, 'No such upload, or it was aborted');
        }
        if (upload.state === 'completed') {
          // A retry after a lost response: same answer as the first time.
          return completedBody(upload);
        }
        if (upload.mode === 'multipart') {
          await this.completeMultipart(upload, parts ?? []);
        }
        await this.checkStoredSize(upload);
        const row = await repos.uploads.markCompleted(upload.id, await this.uniqueCode(repos));
        await notifyUploadEvent(client, {
          uid,
          sessionId: row.session_id,
          uploadId: row.id,
          type: 'completed',
        });
        this.log.info({ uid, uploadId: row.id, byteSize: row.byte_size }, 'upload completed');
        return completedBody(row);
      });
    } catch (error) {
      if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        // Another upload of the same key completed first.
        const existing = await this.db.repos.uploads.completedWithSameKey(id, uid);
        if (existing !== undefined) {
          throw conflict(
            ErrorCode.alreadyCompleted,
            'This key was already uploaded',
            completedBody(existing),
          );
        }
      }
      throw error;
    }
  }

  // The user cancelled, or the app gave up. Idempotent.
  async abort(uid: string, id: string) {
    return this.db.transaction(async (repos, client) => {
      const upload = await repos.uploads.lockOwn(id, uid);
      if (upload === undefined) {
        throw notFound(ErrorCode.uploadNotFound, 'No such upload');
      }
      if (upload.state === 'completed') {
        throw conflict(ErrorCode.alreadyCompleted, 'A completed upload cannot be aborted');
      }
      if (upload.state === 'created') {
        await this.freeStorage(upload);
        await repos.uploads.markAborted(upload.id);
        await notifyUploadEvent(client, {
          uid,
          sessionId: upload.session_id,
          uploadId: upload.id,
          type: 'aborted',
        });
        this.log.info({ uid, uploadId: upload.id }, 'upload aborted');
      }
      return { uploadId: upload.id, aborted: true };
    });
  }

  // Every open upload of a member (leaving the company). Returns how many were aborted.
  async abortAllOpen(uid: string): Promise<number> {
    return this.abortRows(await this.db.repos.uploads.openOf(uid));
  }

  // Worker: uploads begun long ago and never completed.
  async abortAbandoned(limit: number): Promise<number> {
    return this.abortRows(await this.db.repos.uploads.abandoned(limit));
  }

  async findByCode(code: string): Promise<UploadRow | undefined> {
    return this.db.repos.uploads.findCompletedByCode(code);
  }

  private async abortRows(rows: UploadRow[]): Promise<number> {
    let aborted = 0;
    for (const upload of rows) {
      try {
        await this.freeStorage(upload);
        if (await this.db.repos.uploads.markAborted(upload.id)) {
          await notifyUploadEvent(this.db.pool, {
            uid: upload.uid,
            sessionId: upload.session_id,
            uploadId: upload.id,
            type: 'aborted',
          });
          aborted += 1;
        }
      } catch (error) {
        this.log.error({ err: error, uploadId: upload.id }, 'upload abort failed');
      }
    }
    return aborted;
  }

  private async freeStorage(upload: UploadRow): Promise<void> {
    if (upload.mode === 'multipart') {
      await this.storage.abortMultipart(upload.object_key, upload.s3_upload_id!);
    } else {
      await this.storage.deleteObject(upload.object_key);
    }
  }

  private async completeMultipart(upload: UploadRow, parts: CompletedPart[]): Promise<void> {
    checkParts(parts, upload.part_count!);
    try {
      await this.storage.completeMultipart(upload.object_key, upload.s3_upload_id!, parts);
    } catch (error) {
      // S3 may have completed it already on an earlier try whose database write failed.
      if ((await this.storage.head(upload.object_key)) === undefined) {
        throw error;
      }
    }
  }

  private async checkStoredSize(upload: UploadRow): Promise<void> {
    const size = await this.storage.head(upload.object_key);
    if (size === undefined) {
      throw notFound(ErrorCode.objectNotFound, 'Nothing was uploaded for this key');
    }
    if (size !== upload.byte_size) {
      throw badRequest(
        ErrorCode.sizeMismatch,
        `Stored ${size} bytes, expected ${upload.byte_size}`,
      );
    }
  }

  private async uniqueCode(repos: Repositories): Promise<string> {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      const code = newVerificationCode();
      if (!(await repos.uploads.verificationCodeTaken(code))) {
        return code;
      }
    }
    throw new Error('Could not find a free verification code');
  }
}
