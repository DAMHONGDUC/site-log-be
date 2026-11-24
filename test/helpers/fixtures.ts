import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type pg from 'pg';
import { ids, sha } from './helpers.js';

// A completed upload row, as `complete` leaves it.
export async function insertCompletedUpload(
  pool: pg.Pool,
  options: { uid?: string; code?: string; sessionId?: string; sha256?: string } = {},
): Promise<string> {
  const uid = options.uid ?? 'alice';
  const sessionId = options.sessionId ?? ids.session;
  const result = await pool.query<{ id: string }>(
    `insert into uploads (uid, object_key, project_id, session_id, sha256, byte_size, content_type, mode,
                          state, verification_code, verify_state, completed_at)
     values ($1, $2, $3, $4, $5, 1000, 'image/jpeg', 'single', 'completed', $6, 'registered', now())
     returning id`,
    [
      uid,
      `projects/${ids.project}/${sessionId}/${crypto.randomUUID()}.jpg`,
      ids.project,
      sessionId,
      options.sha256 ?? sha,
      options.code ?? 'ABCDEFGH23',
    ],
  );

  return result.rows[0]!.id;
}

// F15: the object body S3 streams back to the verify worker, and its hash.
export function objectBody(text: string) {
  return Readable.from([Buffer.from(text)]);
}

export const contentHash = createHash('sha256').update('photo bytes').digest('hex');
