import { notifyUploadEvent } from '../realtime/events.js';
import type { WorkerDeps } from './verify.js';

// Uploads begun more than 7 days ago and never completed: abort them and free the parts.
// (The S3 lifecycle rule does the same for parts; this also closes the rows.)
export async function abortAbandonedUploads(deps: WorkerDeps): Promise<number> {
  const result = await deps.pool.query<{
    id: string;
    uid: string;
    object_key: string;
    mode: string;
    s3_upload_id: string | null;
    session_id: string | null;
  }>(
    `select id, uid, object_key, mode, s3_upload_id, session_id from uploads
      where state = 'created' and created_at < now() - interval '7 days'
      order by created_at limit 100`,
  );
  let aborted = 0;
  for (const upload of result.rows) {
    try {
      if (upload.mode === 'multipart') {
        await deps.storage.abortMultipart(upload.object_key, upload.s3_upload_id!);
      } else {
        await deps.storage.deleteObject(upload.object_key);
      }
      await deps.pool.query(
        `update uploads set state = 'aborted' where id = $1 and state = 'created'`,
        [upload.id],
      );
      await notifyUploadEvent(deps.pool, {
        uid: upload.uid,
        sessionId: upload.session_id,
        uploadId: upload.id,
        type: 'aborted',
      });
      aborted += 1;
    } catch (error) {
      deps.log.error({ err: error, uploadId: upload.id }, 'abandoned upload: abort failed');
    }
  }
  deps.log.info({ aborted }, 'abandoned uploads checked');
  return aborted;
}
