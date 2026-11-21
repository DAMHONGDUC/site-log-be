import { and, asc, count, eq, inArray, isNull, lt, notLike, or, sql } from 'drizzle-orm';
import { alias, union } from 'drizzle-orm/pg-core';
import { DURATIONS } from '../../constants/durations.js';
import {
  UPLOAD_MODE,
  UPLOAD_STATE,
  VERIFY_STATE,
  type VerifyState,
} from '../../constants/enums.js';
import { KEY_ROOT } from '../../constants/object-keys.js';
import { SQL_LIKE_ANY } from '../../constants/db.js';
import type { SqlDb } from '../../data/drizzle.js';
import {
  captures,
  planSheets,
  projects,
  reportBranding,
  sessions,
  uploads,
} from '../../data/schema/index.js';
import { intervalAgo } from '../../data/sql-time.js';

export type { UploadMode, UploadState, VerifyState } from '../../constants/enums.js';

export type UploadRow = typeof uploads.$inferSelect;
export type NewUpload = Omit<
  typeof uploads.$inferInsert,
  'id' | 'state' | 'verificationCode' | 'verifyState' | 'verifiedAt' | 'createdAt' | 'completedAt'
>;

// The state of one upload as the realtime channel reports it.
const SNAPSHOT = {
  id: uploads.id,
  objectKey: uploads.objectKey,
  sha256: uploads.sha256,
  state: uploads.state,
  verifyState: uploads.verifyState,
};
export type UploadSnapshotRow = Pick<UploadRow, keyof typeof SNAPSHOT>;

// The uploads table joined to itself: "mine" is the caller's upload.
const UPLOAD_ALIAS = { mine: 'mine' } as const;

const isCompleted = eq(uploads.state, UPLOAD_STATE.completed);
const isOpen = eq(uploads.state, UPLOAD_STATE.created);
const own = (id: string, uid: string) => and(eq(uploads.id, id), eq(uploads.uid, uid));

export class UploadRepository {
  constructor(private readonly db: SqlDb) {}

  async create(upload: NewUpload): Promise<string> {
    const [row] = await this.db.insert(uploads).values(upload).returning({ id: uploads.id });
    return row!.id;
  }

  // The caller's own upload, locked for the rest of the transaction.
  async lockOwn(id: string, uid: string): Promise<UploadRow | undefined> {
    const [row] = await this.db.select().from(uploads).where(own(id, uid)).for('update');
    return row;
  }

  async findOpenMultipart(id: string, uid: string): Promise<UploadRow | undefined> {
    const [row] = await this.db
      .select()
      .from(uploads)
      .where(and(own(id, uid), isOpen, eq(uploads.mode, UPLOAD_MODE.multipart)));
    return row;
  }

  async openOf(uid: string): Promise<UploadRow[]> {
    return this.db
      .select()
      .from(uploads)
      .where(and(eq(uploads.uid, uid), isOpen));
  }

  async abandoned(limit: number): Promise<UploadRow[]> {
    return this.db
      .select()
      .from(uploads)
      .where(and(isOpen, lt(uploads.createdAt, intervalAgo(DURATIONS.abandonedUploadAfter))))
      .orderBy(asc(uploads.createdAt))
      .limit(limit);
  }

  async verificationCodeTaken(code: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: uploads.id })
      .from(uploads)
      .where(eq(uploads.verificationCode, code));
    return rows.length > 0;
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
