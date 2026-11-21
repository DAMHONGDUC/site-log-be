import { pgTable, text } from 'drizzle-orm/pg-core';
import { TABLE } from '../../constants/db.js';
import { DEVICE_PLATFORMS } from '../../constants/enums.js';
import type { PushKind } from '../../constants/push.js';
import { timestamptz } from './columns.js';

// Push tokens (migration 0011).
export const devices = pgTable(TABLE.devices, {
  token: text().primaryKey(),
  uid: text().notNull(),
  platform: text({ enum: DEVICE_PLATFORMS }).notNull(),
  createdAt: timestamptz().notNull().defaultNow(),
  updatedAt: timestamptz().notNull().defaultNow(),
  // null = every kind.
  kinds: text().array().$type<PushKind[]>(),
});
