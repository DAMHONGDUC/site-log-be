import type pg from 'pg';

export type UploadEventType = 'completed' | 'aborted' | 'verified' | 'mismatch';

export interface UploadEvent {
  uid: string;
  sessionId: string | null;
  uploadId: string;
  type: UploadEventType;
}

// Tells every API process (through Postgres) that an upload changed. Only ids travel:
// pg_notify payloads are capped at 8000 bytes. Sent at commit, dropped on rollback.
export async function notifyUploadEvent(
  client: pg.PoolClient | pg.Pool,
  event: UploadEvent,
): Promise<void> {
  await client.query(`select pg_notify('upload_events', $1)`, [JSON.stringify(event)]);
}
