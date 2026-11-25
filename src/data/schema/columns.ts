import { bigint, char, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { COLUMN } from '../../constants/data/db.js';
import { LIMITS } from '../../constants/runtime/limits.js';

// Column builders shared by every table. Keys are camelCase; the Drizzle client maps them to
// snake_case (see data/drizzle.ts), so a name is given only where that mapping gets it wrong.

export function timestamptz() {
  return timestamp({ withTimezone: true, mode: 'date' });
}

// snake_case mapping would split the digits off ("sha_256").
export function sha256() {
  return char(COLUMN.sha256, { length: LIMITS.sha256HexLength });
}

export function revColumn() {
  return bigint({ mode: 'number' });
}

// What every synced row carries (02-sync §2) besides its owner column.
export function syncedColumns() {
  return {
    id: uuid().primaryKey(),
    rev: revColumn().notNull(),
    clientUpdatedAt: timestamptz().notNull(),
    deletedAt: timestamptz(),
  };
}

// Synced rows of the team keep who made them; personal rows (phrases) keep uid instead.
export function teamSyncedColumns() {
  return { ...syncedColumns(), createdBy: text().notNull() };
}
