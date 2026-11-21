import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { Logger } from 'pino';
import type { PushSender } from '../push/fcm.js';
import { notify } from '../push/notify.js';
import { membersReaching } from '../team/access.js';
import { notifyUploadEvent } from '../realtime/events.js';
import type { Storage } from '../storage.js';

export interface WorkerDeps {
  pool: pg.Pool;
  storage: Storage;
  push: PushSender | undefined;
  log: Logger;
}

interface ClaimedUpload {
  id: string;
  uid: string;
  object_key: string;
  sha256: string;
  session_id: string | null;
}

// A claim older than this belongs to a worker that crashed; another one may take it.
const CLAIM_TIMEOUT = '30 minutes';

// Takes the oldest unverified upload, streams it back from S3 and recomputes SHA-256.
// Returns false when there was nothing to do.
export async function verifyNextUpload(deps: WorkerDeps): Promise<boolean> {
  const claimed = await deps.pool.query<ClaimedUpload>(
    `update uploads set verify_claimed_at = now()
      where id = (
        select id from uploads
         where state = 'completed' and verify_state = 'registered'
           and (verify_claimed_at is null or verify_claimed_at < now() - interval '${CLAIM_TIMEOUT}')
         order by completed_at
         limit 1
         for update skip locked
      )
  returning id, uid, object_key, sha256, session_id`,
  );
  const upload = claimed.rows[0];
  if (upload === undefined) {
    return false;
  }

  const hash = createHash('sha256');
  const stream = await deps.storage.readStream(upload.object_key);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  const actual = hash.digest('hex');

  let state: 'verified' | 'mismatch' = 'verified';
  if (actual !== upload.sha256) {
    state = 'mismatch';
  }
  await deps.pool.query(`update uploads set verify_state = $2, verified_at = now() where id = $1`, [
    upload.id,
    state,
  ]);
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
  if (deps.push === undefined) {
    return;
  }
  const pending = await deps.pool.query(
    `select 1 from uploads
      where session_id = $1
        and (state = 'created' or verify_state = 'registered')
      limit 1`,
    [sessionId],
  );
  if (pending.rows.length > 0) {
    return;
  }
  const facts = await deps.pool.query<{
    project_id: string | null;
    files: string;
    name: string | null;
  }>(
    `select u.project_id, count(*)::text as files, p.name
       from uploads u left join projects p on p.id = u.project_id
      where u.session_id = $1 and u.state = 'completed'
      group by u.project_id, p.name`,
    [sessionId],
  );
  const fact = facts.rows[0];
  let recipients = [uid];
  if (fact?.project_id) {
    recipients = await membersReaching(deps.pool, fact.project_id);
  }
  await notify(deps.pool, deps.push, deps.log, {
    kind: 'uploadsVerified',
    recipients,
    actorUid: null,
    title: 'Walkthrough is safe',
    body: `All ${fact?.files ?? 'the'} files${fact?.name ? ` of ${fact.name}` : ''} are uploaded and verified.`,
    deepLink: `sitelog://session/${sessionId}`,
  });
  deps.log.info({ uid, sessionId }, 'session verified: push sent');
}
