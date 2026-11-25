import {
  bigserial,
  boolean,
  customType,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { PG_ENUM, TABLE } from '../../constants/data/db.js';
import { MEMBER_EVENT_TYPES } from '../../constants/data/enums.js';
import { ROLES } from '../../constants/domain/roles.js';
import { timestamptz } from './columns.js';

// Team tables (migration 0012, 05-team-and-roles).

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const memberRole = pgEnum(PG_ENUM.memberRole, ROLES);

export const members = pgTable(TABLE.members, {
  uid: text().primaryKey(),
  email: text().notNull(),
  name: text().notNull().default(''),
  role: memberRole().notNull(),
  resyncRequired: boolean().notNull().default(false),
  createdAt: timestamptz().notNull().defaultNow(),
  lastSeenAt: timestamptz(),
  removedAt: timestamptz(),
});

export const projectMembers = pgTable(
  TABLE.projectMembers,
  {
    projectId: uuid().notNull(),
    uid: text().notNull(),
    addedBy: text(),
    addedAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.uid] })],
);

export const invitations = pgTable(TABLE.invitations, {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull(),
  role: memberRole().notNull(),
  projectIds: uuid().array().notNull().default([]),
  tokenHash: bytea().notNull(),
  invitedBy: text().notNull(),
  createdAt: timestamptz().notNull().defaultNow(),
  expiresAt: timestamptz().notNull(),
  acceptedAt: timestamptz(),
  acceptedBy: text(),
  cancelledAt: timestamptz(),
});

// Append-only audit (05 §9).
export const memberEvents = pgTable(TABLE.memberEvents, {
  id: bigserial({ mode: 'number' }).primaryKey(),
  at: timestamptz().notNull().defaultNow(),
  actorUid: text(),
  type: text({ enum: MEMBER_EVENT_TYPES }).notNull(),
  subjectUid: text(),
  invitationId: uuid(),
  detail: jsonb().$type<Record<string, unknown>>().notNull().default({}),
});
