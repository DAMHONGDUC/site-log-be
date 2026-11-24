import { and, asc, count, eq, inArray, isNull, lt, notLike, or, sql } from 'drizzle-orm';
import { alias, union } from 'drizzle-orm/pg-core';
import { DURATIONS } from '../../../constants/runtime/durations.js';
import {
  UPLOAD_MODE,
  UPLOAD_STATE,
  VERIFY_STATE,
  type VerifyState,
} from '../../../constants/data/enums.js';
import { KEY_ROOT } from '../../../constants/domain/object-keys.js';
import { SQL_LIKE_ANY, TABLE_ALIAS } from '../../../constants/data/db.js';
import type { SqlDb } from '../../../data/drizzle.js';
import {
  captures,
  planSheets,
  projects,
  reportBranding,
  sessions,
  uploads,
} from '../../../data/schema/index.js';
import { intervalAgo } from '../../../data/sql-time.js';

export type { UploadMode, UploadState, VerifyState } from '../../../constants/data/enums.js';

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
    const [row] = await this.db
      .update(uploads)
      .set({
        state: UPLOAD_STATE.completed,
        completedAt: sql`now()`,
        verificationCode: code,
        verifyState: VERIFY_STATE.registered,
      })
      .where(eq(uploads.id, id))
      .returning();

    return row!;
  }

  // true when it was still open.
  async markAborted(id: string): Promise<boolean> {
    const result = await this.db
      .update(uploads)
      .set({ state: UPLOAD_STATE.aborted })
      .where(and(eq(uploads.id, id), isOpen));

    return (result.rowCount ?? 0) > 0;
  }

  // The completed upload that already holds the key of this (caller's) upload.
  async completedWithSameKey(id: string, uid: string): Promise<UploadRow | undefined> {
    const mine = alias(uploads, TABLE_ALIAS.mine);
    const [row] = await this.db
      .select({ upload: uploads })
      .from(uploads)
      .innerJoin(mine, eq(mine.objectKey, uploads.objectKey))
      .where(and(eq(mine.id, id), eq(mine.uid, uid), isCompleted));

    return row?.upload;
  }

  async findCompletedByCode(code: string): Promise<UploadRow | undefined> {
    const [row] = await this.db
      .select()
      .from(uploads)
      .where(and(eq(uploads.verificationCode, code), isCompleted));

    return row;
  }

  async snapshot(id: string): Promise<UploadSnapshotRow | undefined> {
    const [row] = await this.db.select(SNAPSHOT).from(uploads).where(eq(uploads.id, id));

    return row;
  }

  async finishedInSession(sessionId: string): Promise<UploadSnapshotRow[]> {
    return this.db
      .select(SNAPSHOT)
      .from(uploads)
      .where(
        and(
          eq(uploads.sessionId, sessionId),
          inArray(uploads.state, [UPLOAD_STATE.completed, UPLOAD_STATE.aborted]),
        ),
      );
  }

  // Claims the oldest completed, unverified upload (skipping rows other workers hold).
  async claimNextToVerify(): Promise<UploadRow | undefined> {
    const next = this.db
      .select({ id: uploads.id })
      .from(uploads)
      .where(
        and(
          isCompleted,
          eq(uploads.verifyState, VERIFY_STATE.registered),
          or(
            isNull(uploads.verifyClaimedAt),
            lt(uploads.verifyClaimedAt, intervalAgo(DURATIONS.verifyClaimTimeout)),
          ),
        ),
      )
      .orderBy(asc(uploads.completedAt))
      .limit(1)
      .for('update', { skipLocked: true });
    const [row] = await this.db
      .update(uploads)
      .set({ verifyClaimedAt: sql`now()` })
      .where(eq(uploads.id, sql`(${next})`))
      .returning();

    return row;
  }

  async setVerifyState(id: string, state: VerifyState): Promise<void> {
    await this.db
      .update(uploads)
      .set({ verifyState: state, verifiedAt: sql`now()` })
      .where(eq(uploads.id, id));
  }

  async sessionHasPending(sessionId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: uploads.id })
      .from(uploads)
      .where(
        and(
          eq(uploads.sessionId, sessionId),
          or(isOpen, eq(uploads.verifyState, VERIFY_STATE.registered)),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  async sessionSummary(
    sessionId: string,
  ): Promise<{ projectId: string | null; files: number; projectName: string | null } | undefined> {
    const [row] = await this.db
      .select({ projectId: uploads.projectId, files: count(), projectName: projects.name })
      .from(uploads)
      .leftJoin(projects, eq(projects.id, uploads.projectId))
      .where(and(eq(uploads.sessionId, sessionId), isCompleted))
      .groupBy(uploads.projectId, projects.name);

    return row;
  }

  async projectsOfSession(sessionId: string): Promise<(string | null)[]> {
    const rows = await union(
      this.db
        .select({ projectId: sql<string | null>`${sessions.projectId}` })
        .from(sessions)
        .where(eq(sessions.id, sessionId)),
      this.db
        .select({ projectId: uploads.projectId })
        .from(uploads)
        .where(eq(uploads.sessionId, sessionId)),
    );

    return rows.map((row) => row.projectId);
  }

  // Pre-F19 keys still waiting for move-keys.
  async completedWithLegacyKeys(): Promise<Pick<UploadRow, 'id' | 'objectKey'>[]> {
    return this.db
      .select({ id: uploads.id, objectKey: uploads.objectKey })
      .from(uploads)
      .where(
        and(
          isCompleted,
          notLike(uploads.objectKey, KEY_ROOT.projects + SQL_LIKE_ANY),
          notLike(uploads.objectKey, KEY_ROOT.company + SQL_LIKE_ANY),
        ),
      )
      .orderBy(asc(uploads.completedAt));
  }

  // Points the upload and every synced row that names the old key at the new one.
  async renameKey(id: string, oldKey: string, newKey: string): Promise<void> {
    await this.db.update(uploads).set({ objectKey: newKey }).where(eq(uploads.id, id));
    await this.db.update(captures).set({ remoteKey: newKey }).where(eq(captures.remoteKey, oldKey));
    await this.db
      .update(planSheets)
      .set({ remoteKey: newKey })
      .where(eq(planSheets.remoteKey, oldKey));
    await this.db
      .update(reportBranding)
      .set({ logoKey: newKey })
      .where(eq(reportBranding.logoKey, oldKey));
  }
}
