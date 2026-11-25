import type pg from 'pg';
import { UPLOAD_EVENTS_CHANNEL, type UploadEventType } from '../../constants/domain/realtime.js';

export type { UploadEventType } from '../../constants/domain/realtime.js';

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
  await client.query('select pg_notify($1, $2)', [UPLOAD_EVENTS_CHANNEL, JSON.stringify(event)]);
}
