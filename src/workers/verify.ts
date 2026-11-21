import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { Database } from '../data/database.js';
import type { Log } from '../domain/log.js';
import { notifyUploadEvent } from '../realtime/events.js';
import type { CoreServices } from '../services/index.js';
import type { Storage } from '../storage.js';

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

  const hash = createHash('sha256');
  const stream = await deps.storage.readStream(upload.object_key);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  const state = hash.digest('hex') === upload.sha256 ? 'verified' : 'mismatch';
  await deps.db.repos.uploads.setVerifyState(upload.id, state);
  await notifyUploadEvent(deps.pool, {
    uid: upload.uid,
    sessionId: upload.session_id,
    uploadId: upload.id,
    type: state,
  });
  deps.log.info(
    { uid: upload.uid, uploadId: upload.id, key: upload.object_key, state },
    'upload verified',
  );

  if (state === 'verified' && upload.session_id !== null) {
    await pushWhenSessionVerified(deps, upload.uid, upload.session_id);
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
    kind: 'uploadsVerified',
    recipients,
    actorUid: null,
    data: { sessionId, files: summary?.files ?? null, projectName: summary?.projectName ?? null },
  });
  deps.log.info({ uid, sessionId }, 'session verified: push sent');
}
