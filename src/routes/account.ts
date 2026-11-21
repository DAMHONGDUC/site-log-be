import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { AppDeps } from '../app.js';
import { withTransaction } from '../db.js';
import { conflict } from '../errors.js';
import { notifyUploadEvent } from '../realtime/events.js';
import { loadMember } from '../team/access.js';
import { recordMemberEvent } from '../team/events.js';

// Server-only tables (truncated between tests). A feature that adds one adds it here.
export const serverTables: string[] = [
  'uploads',
  'devices',
  'project_members',
  'invitations',
  'member_events',
  'members',
];

// F19 (05 §8): leaving the company. The caller's unfinished uploads, phrases, devices and
// Firebase user go; photos, issues and reports stay with the company.
// Safe to call again: a repeat finds nothing and returns zeros.
export function accountRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  requireSignedIn: preHandlerAsyncHookHandler,
): void {
  app.delete('/account', { preHandler: requireSignedIn }, async (request) => {
    const uid = request.uid;
    const lookup = await loadMember(deps.pool, uid);
    if (lookup.status === 'member' && lookup.member.role === 'admin') {
      const admins = await deps.pool.query<{ count: string }>(
        `select count(*)::text as count from members where role = 'admin' and removed_at is null`,
      );
      if (Number(admins.rows[0]!.count) <= 1) {
        throw conflict('last_admin', 'The last Admin cannot leave; make someone else Admin first');
      }
    }

    // Unfinished uploads: free the parts in S3, then close the rows.
    const open = await deps.pool.query<{
      id: string;
      object_key: string;
      mode: string;
      s3_upload_id: string | null;
      session_id: string | null;
    }>(
      `select id, object_key, mode, s3_upload_id, session_id from uploads
        where uid = $1 and state = 'created'`,
      [uid],
    );
    let abortedUploads = 0;
    for (const upload of open.rows) {
      if (upload.mode === 'multipart') {
        await deps.storage.abortMultipart(upload.object_key, upload.s3_upload_id!);
      }
      await deps.pool.query(`update uploads set state = 'aborted' where id = $1`, [upload.id]);
      await notifyUploadEvent(deps.pool, {
        uid,
        sessionId: upload.session_id,
        uploadId: upload.id,
        type: 'aborted',
      });
      abortedUploads += 1;
    }

    const deletedRows = await withTransaction(deps.pool, async (client) => {
      let count = 0;
      for (const sql of [
        'delete from phrases where uid = $1',
        'delete from devices where uid = $1',
        'delete from project_members where uid = $1',
      ]) {
        const result = await client.query(sql, [uid]);
        count += result.rowCount ?? 0;
      }
      const removed = await client.query(
        'update members set removed_at = now() where uid = $1 and removed_at is null',
        [uid],
      );
      if ((removed.rowCount ?? 0) > 0) {
        await recordMemberEvent(client, {
          actorUid: uid,
          type: 'account_deleted',
          subjectUid: uid,
        });
      }
      return count;
    });

    await deps.tokens.deleteUser(uid);
    request.log.info({ uid, abortedUploads, deletedRows }, 'account deleted');
    return { abortedUploads, deletedRows };
  });
}
