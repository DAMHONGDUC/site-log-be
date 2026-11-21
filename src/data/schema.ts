// Server-only tables (everything the app writes besides the synced tables). Tests truncate them;
// a feature that adds one adds it here.
export const SERVER_TABLES = [
  'uploads',
  'devices',
  'project_members',
  'invitations',
  'member_events',
  'members',
] as const;
