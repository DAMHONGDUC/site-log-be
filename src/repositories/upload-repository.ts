import { DURATIONS } from '../constants/durations.js';
import type { Queryable } from '../data/database.js';

export type UploadMode = 'single' | 'multipart';
export type UploadState = 'created' | 'completed' | 'aborted';
export type VerifyState = 'registered' | 'verified' | 'mismatch';

export interface UploadRow {
  id: string;
  uid: string;
  object_key: string;
  project_id: string | null;
  session_id: string | null;
  sha256: string;
  byte_size: number;
  content_type: string;
  mode: UploadMode;
  s3_upload_id: string | null;
  part_count: number | null;
  state: UploadState;
  verification_code: string | null;
  verify_state: VerifyState | null;
  verified_at: Date | null;
  completed_at: Date | null;
}

export interface NewUpload {
  uid: string;
  objectKey: string;
  projectId: string | null;
  sessionId: string | null;
  sha256: string;
  byteSize: number;
  contentType: string;
  mode: UploadMode;
  s3UploadId: string | null;
  partCount: number | null;
}

// The state of one upload as the realtime channel reports it.
export type UploadSnapshotRow = Pick<
  UploadRow,
  'id' | 'object_key' | 'sha256' | 'state' | 'verify_state'
>;

export class UploadRepository {
  constructor(private readonly db: Queryable) {}

  async create(upload: NewUpload): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `insert into uploads
         (uid, object_key, project_id, session_id, sha256, byte_size, content_type, mode, s3_upload_id, part_count)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [
        upload.uid,
        upload.objectKey,
        upload.projectId,
        upload.sessionId,
        upload.sha256,
        upload.byteSize,
        upload.contentType,
        upload.mode,
        upload.s3UploadId,
        upload.partCount,
      ],
    );
    return result.rows[0]!.id;
  }

  // The caller's own upload, locked for the rest of the transaction.
  async lockOwn(id: string, uid: string): Promise<UploadRow | undefined> {
    const result = await this.db.query<UploadRow>(
      'select * from uploads where id = $1 and uid = $2 for update',
      [id, uid],
    );
    return result.rows[0];
  }

  async findOpenMultipart(id: string, uid: string): Promise<UploadRow | undefined> {
    const result = await this.db.query<UploadRow>(
      `select * from uploads where id = $1 and uid = $2 and state = 'created' and mode = 'multipart'`,
      [id, uid],
    );
    return result.rows[0];
  }

  async openOf(uid: string): Promise<UploadRow[]> {
    const result = await this.db.query<UploadRow>(
      `select * from uploads where uid = $1 and state = 'created'`,
      [uid],
    );
    return result.rows;
  }

  async abandoned(limit: number): Promise<UploadRow[]> {
    const result = await this.db.query<UploadRow>(
      `select * from uploads
        where state = 'created' and created_at < now() - $1::interval
        order by created_at limit $2`,
      [DURATIONS.abandonedUploadAfter, limit],
    );
    return result.rows;
  }

  async verificationCodeTaken(code: string): Promise<boolean> {
    const result = await this.db.query('select 1 from uploads where verification_code = $1', [
      code,
    ]);
    return result.rows.length > 0;
  }

  async markCompleted(id: string, code: string): Promise<UploadRow> {
    const result = await this.db.query<UploadRow>(
      `update uploads
          set state = 'completed', completed_at = now(),
              verification_code = $2, verify_state = 'registered'
        where id = $1
      returning *`,
      [id, code],
    );
    return result.rows[0]!;
  }

  // true when it was still open.
  async markAborted(id: string): Promise<boolean> {
    const result = await this.db.query(
      `update uploads set state = 'aborted' where id = $1 and state = 'created'`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  // The completed upload that already holds the key of this (caller's) upload.
  async completedWithSameKey(id: string, uid: string): Promise<UploadRow | undefined> {
    const result = await this.db.query<UploadRow>(
      `select u.* from uploads u
         join uploads mine on mine.object_key = u.object_key
        where mine.id = $1 and mine.uid = $2 and u.state = 'completed'`,
      [id, uid],
    );
    return result.rows[0];
  }

  async findCompletedByCode(code: string): Promise<UploadRow | undefined> {
    const result = await this.db.query<UploadRow>(
      `select * from uploads where verification_code = $1 and state = 'completed'`,
      [code],
    );
    return result.rows[0];
  }

  async snapshot(id: string): Promise<UploadSnapshotRow | undefined> {
    const result = await this.db.query<UploadSnapshotRow>(
      'select id, object_key, sha256, state, verify_state from uploads where id = $1',
      [id],
    );
    return result.rows[0];
  }

  async finishedInSession(sessionId: string): Promise<UploadSnapshotRow[]> {
    const result = await this.db.query<UploadSnapshotRow>(
      `select id, object_key, sha256, state, verify_state from uploads
        where session_id = $1 and state in ('completed', 'aborted')`,
      [sessionId],
    );
    return result.rows;
  }

  // Claims the oldest completed, unverified upload (skipping rows other workers hold).
  async claimNextToVerify(): Promise<UploadRow | undefined> {
    const result = await this.db.query<UploadRow>(
      `update uploads set verify_claimed_at = now()
        where id = (
          select id from uploads
           where state = 'completed' and verify_state = 'registered'
             and (verify_claimed_at is null or verify_claimed_at < now() - $1::interval)
           order by completed_at
           limit 1
           for update skip locked
        )
    returning *`,
      [DURATIONS.verifyClaimTimeout],
    );
    return result.rows[0];
  }

  async setVerifyState(id: string, state: VerifyState): Promise<void> {
    await this.db.query('update uploads set verify_state = $2, verified_at = now() where id = $1', [
      id,
      state,
    ]);
  }

  async sessionHasPending(sessionId: string): Promise<boolean> {
    const result = await this.db.query(
      `select 1 from uploads
        where session_id = $1 and (state = 'created' or verify_state = 'registered')
        limit 1`,
      [sessionId],
    );
    return result.rows.length > 0;
  }

  async sessionSummary(
    sessionId: string,
  ): Promise<{ projectId: string | null; files: number; projectName: string | null } | undefined> {
    const result = await this.db.query<{
      project_id: string | null;
      files: number;
      name: string | null;
    }>(
      `select u.project_id, count(*)::int as files, p.name
         from uploads u left join projects p on p.id = u.project_id
        where u.session_id = $1 and u.state = 'completed'
        group by u.project_id, p.name`,
      [sessionId],
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : { projectId: row.project_id, files: row.files, projectName: row.name };
  }

  async projectsOfSession(sessionId: string): Promise<(string | null)[]> {
    const result = await this.db.query<{ project_id: string | null }>(
      `select project_id from sessions where id = $1
       union select project_id from uploads where session_id = $1`,
      [sessionId],
    );
    return result.rows.map((row) => row.project_id);
  }

  // Pre-F19 keys still waiting for move-keys.
  async completedWithLegacyKeys(): Promise<Pick<UploadRow, 'id' | 'object_key'>[]> {
    const result = await this.db.query<Pick<UploadRow, 'id' | 'object_key'>>(
      `select id, object_key from uploads
        where state = 'completed' and object_key not like 'projects/%' and object_key not like 'company/%'
        order by completed_at`,
    );
    return result.rows;
  }

  // Points the upload and every row that names the old key at the new one.
  async renameKey(id: string, oldKey: string, newKey: string): Promise<void> {
    await this.db.query('update uploads set object_key = $2 where id = $1', [id, newKey]);
    for (const [table, column] of KEY_COLUMNS) {
      await this.db.query(`update ${table} set ${column} = $2 where ${column} = $1`, [
        oldKey,
        newKey,
      ]);
    }
  }
}

// Synced columns that hold an object key.
const KEY_COLUMNS = [
  ['captures', 'remote_key'],
  ['plan_sheets', 'remote_key'],
  ['report_branding', 'logo_key'],
] as const;
