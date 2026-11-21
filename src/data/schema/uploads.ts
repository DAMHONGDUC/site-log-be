import { bigint, integer, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { COLUMN, PG_ENUM, TABLE } from '../../constants/db.js';
import { UPLOAD_MODES, UPLOAD_STATES, VERIFY_STATES } from '../../constants/enums.js';
import { sha256, timestamptz } from './columns.js';

// Server-only upload records (migrations 0004, 0010).

export const uploadMode = pgEnum(PG_ENUM.uploadMode, UPLOAD_MODES);
export const uploadState = pgEnum(PG_ENUM.uploadState, UPLOAD_STATES);
export const verifyState = pgEnum(PG_ENUM.verifyState, VERIFY_STATES);

export const uploads = pgTable(TABLE.uploads, {
  id: uuid().primaryKey().defaultRandom(),
  uid: text().notNull(),
  objectKey: text().notNull(),
  projectId: uuid(),
  sessionId: uuid(),
  sha256: sha256().notNull(),
  byteSize: bigint({ mode: 'number' }).notNull(),
  contentType: text().notNull(),
  mode: uploadMode().notNull(),
  // snake_case mapping would split the digit off ("s_3_upload_id").
  s3UploadId: text(COLUMN.s3UploadId),
  partCount: integer(),
  state: uploadState().notNull().default('created'),
  verificationCode: text(),
  verifyState: verifyState(),
  verifiedAt: timestamptz(),
  createdAt: timestamptz().notNull().defaultNow(),
  completedAt: timestamptz(),
  verifyClaimedAt: timestamptz(),
});
