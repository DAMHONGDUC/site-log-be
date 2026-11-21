import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { Database } from '../data/database.js';
import type { Log } from '../core/log.js';
import { notifyUploadEvent } from '../modules/realtime/events.js';
import type { CoreServices } from '../services.js';
import type { Storage } from '../integrations/storage.js';
import { HASH, ENCODING } from '../constants/platform/encoding.js';
import { VERIFY_STATE } from '../constants/data/enums.js';
import { LOG } from '../constants/messages/log.js';
import { PUSH_KIND } from '../constants/domain/push.js';

export interface WorkerDeps {
  pool: pg.Pool;
  db: Database;
  storage: Storage;
  services: CoreServices;
  log: Log;
}

// Takes the oldest unverified upload, streams it back from S3 and recomputes SHA-256.
// Returns false when there was nothing to do.
export async function verifyNextUpload(deps: WorkerDeps): Promise<boolean> {
  const upload = await deps.db.repos.uploads.claimNextToVerify();
  if (upload === undefined) {
    return false;
  }

  const hash = createHash(HASH.sha256);
  const stream = await deps.storage.readStream(upload.objectKey);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  const state =
    hash.digest(ENCODING.hex) === upload.sha256 ? VERIFY_STATE.verified : VERIFY_STATE.mismatch;
  await deps.db.repos.uploads.setVerifyState(upload.id, state);
  await notifyUploadEvent(deps.pool, {
    uid: upload.uid,
    sessionId: upload.sessionId,
    uploadId: upload.id,
    type: state,
  });
  deps.log.info(
    { uid: upload.uid, uploadId: upload.id, key: upload.objectKey, state },
    LOG.uploads.verified,
  );

  if (state === VERIFY_STATE.verified && upload.sessionId !== null) {
    await pushWhenSessionVerified(deps, upload.uid, upload.sessionId);
  }
  return true;
}

// F16, F19: one push when the last upload of a session is verified, to every member who
// reaches the project (and whose device wants this kind).
async function pushWhenSessionVerified(
  deps: WorkerDeps,
  uid: string,
  sessionId: string,
): Promise<void> {
  const { uploads } = deps.db.repos;
  if (await uploads.sessionHasPending(sessionId)) {
    return;
  }
  const summary = await uploads.sessionSummary(sessionId);
  const recipients = summary?.projectId
    ? await deps.services.access.membersReaching(summary.projectId)
    : [uid];
  await deps.services.notifications.send({
    kind: PUSH_KIND.uploadsVerified,
    recipients,
    actorUid: null,
    data: { sessionId, files: summary?.files ?? null, projectName: summary?.projectName ?? null },
  });
  deps.log.info({ uid, sessionId }, LOG.push.sessionVerified);
}
