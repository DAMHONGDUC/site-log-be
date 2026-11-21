import { newVerificationCode } from '../verify/verification-code.js';
import type { Config } from '../../../core/config.js';
import { ErrorCode } from '../../../constants/http/error-codes.js';
import { HTTP_STATUS } from '../../../constants/http/http-status.js';
import { LIMITS } from '../../../constants/runtime/limits.js';
import type { Database } from '../../../data/database.js';
import type { Log } from '../../../core/log.js';
import type { Member } from '../../team/index.js';
import { AppError, badRequest, conflict, notFound } from '../../../core/errors.js';
import { notifyUploadEvent } from '../../realtime/index.js';
import type { Repositories } from '../../../data/repositories.js';
import type { UploadRow } from './upload-repository.js';
import type { CompletedPart, Storage } from '../../../integrations/storage.js';
import type { FileAccessService } from '../media/file-access-service.js';
import { PG_ERROR } from '../../../constants/platform/external.js';
import { UPLOAD_MODE, UPLOAD_STATE, VERIFY_STATE } from '../../../constants/data/enums.js';
import { ERROR_TEXT, FAULT_TEXT } from '../../../constants/messages/error-text.js';
import { FILE_ACCESS } from '../../../constants/domain/team.js';
import { KEY_KIND } from '../../../constants/domain/object-keys.js';
import { LOG } from '../../../constants/messages/log.js';
import { UPLOAD_EVENT } from '../../../constants/domain/realtime.js';

const CODE_ATTEMPTS = 5;

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
    remoteKey: row.objectKey,
    sha256: row.sha256,
    verificationCode: row.verificationCode,
    verified: row.verifyState === VERIFY_STATE.verified,
    receivedAt: row.completedAt,
  };
}

// Every part number from 1 to partCount exactly once.
function checkParts(parts: CompletedPart[], partCount: number): void {
  if (parts.length !== partCount) {
    throw badRequest(ErrorCode.invalidParts, ERROR_TEXT.partCount(partCount, parts.length));
  }
  const seen = new Set<number>();
  for (const part of parts) {
    if (part.number < 1 || part.number > partCount || seen.has(part.number)) {
      throw badRequest(ErrorCode.invalidParts, ERROR_TEXT.badPart(part.number));
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
    const parsed = await this.files.check(member, input.key, FILE_ACCESS.write);
    if (input.byteSize > this.config.maxUploadBytes) {
      throw new AppError(
        HTTP_STATUS.payloadTooLarge,
        ErrorCode.fileTooLarge,
        ERROR_TEXT.fileTooLarge,
      );
    }
    const projectId = parsed.kind === KEY_KIND.branding ? null : parsed.projectId;
    const sessionId = parsed.kind === KEY_KIND.capture ? parsed.sessionId : null;
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
        mode: UPLOAD_MODE.single,
        s3UploadId: null,
        partCount: null,
      });
      const url = await this.storage.presignPut(input.key, input.contentType);
      this.log.info(
        { uid: member.uid, uploadId, key: input.key, mode: UPLOAD_MODE.single },
        LOG.uploads.begun,
      );
      return { mode: UPLOAD_MODE.single, uploadId, url, expiresAt };
    }

    const partCount = Math.ceil(input.byteSize / this.config.partSizeBytes);
    if (partCount > LIMITS.s3MaxParts) {
      throw new AppError(
        HTTP_STATUS.payloadTooLarge,
        ErrorCode.fileTooLarge,
        ERROR_TEXT.tooManyParts(LIMITS.s3MaxParts),
      );
    }
    const s3UploadId = await this.storage.createMultipart(input.key, input.contentType);
    const uploadId = await this.db.repos.uploads.create({
      ...base,
      mode: UPLOAD_MODE.multipart,
      s3UploadId,
      partCount,
    });
    const parts: { number: number; url: string }[] = [];
    for (let number = 1; number <= partCount; number += 1) {
      parts.push({ number, url: await this.storage.presignPart(input.key, s3UploadId, number) });
    }
    this.log.info(
      { uid: member.uid, uploadId, partCount, mode: UPLOAD_MODE.multipart },
      LOG.uploads.begun,
    );
    return {
      mode: UPLOAD_MODE.multipart,
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
      throw notFound(ErrorCode.uploadNotFound, ERROR_TEXT.noOpenMultipart);
    }
    const parts: { number: number; url: string }[] = [];
    for (const number of numbers) {
      if (number > upload.partCount!) {
        throw badRequest(ErrorCode.invalidParts, ERROR_TEXT.partPastLast(number));
      }
      parts.push({
        number,
        url: await this.storage.presignPart(upload.objectKey, upload.s3UploadId!, number),
      });
    }
    this.log.info({ uid, uploadId: upload.id, count: parts.length }, LOG.uploads.partsRefreshed);
    return { parts, expiresAt: this.storage.expiresAt(new Date()) };
  }

  // Confirms the object exists, records it, issues a verification code. Idempotent.
  async complete(uid: string, id: string, parts: CompletedPart[] | undefined) {
    try {
      return await this.db.transaction(async (repos, client) => {
        const upload = await repos.uploads.lockOwn(id, uid);
        if (upload === undefined || upload.state === UPLOAD_STATE.aborted) {
          throw notFound(ErrorCode.uploadNotFound, ERROR_TEXT.uploadGone);
        }
        if (upload.state === UPLOAD_STATE.completed) {
          // A retry after a lost response: same answer as the first time.
          return completedBody(upload);
        }
        if (upload.mode === UPLOAD_MODE.multipart) {
          await this.completeMultipart(upload, parts ?? []);
        }
        await this.checkStoredSize(upload);
        const row = await repos.uploads.markCompleted(upload.id, await this.uniqueCode(repos));
        await notifyUploadEvent(client, {
          uid,
          sessionId: row.sessionId,
          uploadId: row.id,
          type: UPLOAD_EVENT.completed,
        });
        this.log.info({ uid, uploadId: row.id, byteSize: row.byteSize }, LOG.uploads.completed);
        return completedBody(row);
      });
    } catch (error) {
      if ((error as { code?: string }).code === PG_ERROR.uniqueViolation) {
        // Another upload of the same key completed first.
        const existing = await this.db.repos.uploads.completedWithSameKey(id, uid);
        if (existing !== undefined) {
          throw conflict(
            ErrorCode.alreadyCompleted,
            ERROR_TEXT.keyUploaded,
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
        throw notFound(ErrorCode.uploadNotFound, ERROR_TEXT.uploadNotFound);
      }
      if (upload.state === UPLOAD_STATE.completed) {
        throw conflict(ErrorCode.alreadyCompleted, ERROR_TEXT.completedAbort);
      }
      if (upload.state === UPLOAD_STATE.created) {
        await this.freeStorage(upload);
        await repos.uploads.markAborted(upload.id);
        await notifyUploadEvent(client, {
          uid,
          sessionId: upload.sessionId,
          uploadId: upload.id,
          type: UPLOAD_EVENT.aborted,
        });
        this.log.info({ uid, uploadId: upload.id }, LOG.uploads.aborted);
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
            sessionId: upload.sessionId,
            uploadId: upload.id,
            type: UPLOAD_EVENT.aborted,
          });
          aborted += 1;
        }
      } catch (error) {
        this.log.error({ err: error, uploadId: upload.id }, LOG.uploads.abortFailed);
      }
    }
    return aborted;
  }

  private async freeStorage(upload: UploadRow): Promise<void> {
    if (upload.mode === UPLOAD_MODE.multipart) {
      await this.storage.abortMultipart(upload.objectKey, upload.s3UploadId!);
    } else {
      await this.storage.deleteObject(upload.objectKey);
    }
  }

  private async completeMultipart(upload: UploadRow, parts: CompletedPart[]): Promise<void> {
    checkParts(parts, upload.partCount!);
    try {
      await this.storage.completeMultipart(upload.objectKey, upload.s3UploadId!, parts);
    } catch (error) {
      // S3 may have completed it already on an earlier try whose database write failed.
      if ((await this.storage.head(upload.objectKey)) === undefined) {
        throw error;
      }
    }
  }

  private async checkStoredSize(upload: UploadRow): Promise<void> {
    const size = await this.storage.head(upload.objectKey);
    if (size === undefined) {
      throw notFound(ErrorCode.objectNotFound, ERROR_TEXT.nothingUploaded);
    }
    if (size !== upload.byteSize) {
      throw badRequest(ErrorCode.sizeMismatch, ERROR_TEXT.storedSize(size, upload.byteSize));
    }
  }

  private async uniqueCode(repos: Repositories): Promise<string> {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      const code = newVerificationCode();
      if (!(await repos.uploads.verificationCodeTaken(code))) {
        return code;
      }
    }
    throw new Error(FAULT_TEXT.noFreeCode);
  }
}
