// The Drizzle schema: the shape of every table, for typed queries. Migrations (migrations/*.sql)
// stay the source of truth; test/data/schema.test.ts fails when the two disagree.
import { TABLE } from '../../constants/data/db.js';

export * from './devices.js';
export * from './sync.js';
export * from './team.js';
export * from './uploads.js';

// Server-only tables (everything the app writes besides the synced tables). Tests truncate them;
// a feature that adds one adds it here.
export const SERVER_TABLES = [
  TABLE.uploads,
  TABLE.devices,
  TABLE.projectMembers,
  TABLE.invitations,
  TABLE.memberEvents,
  TABLE.members,
] as const;
