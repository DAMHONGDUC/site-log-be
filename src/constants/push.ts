// Push kinds (01-api §10) and the deep links a push opens.

export const PUSH_KINDS = [
  'uploadsVerified',
  'issueAssigned',
  'issueRechecked',
  'dueSoon',
  'access',
] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

export const DEEP_LINK = {
  session: (id: string) => `sitelog://session/${id}`,
  issue: (id: string) => `sitelog://issue/${id}`,
  project: (id: string) => `sitelog://project/${id}`,
  // Nothing to open (removed from a project, a new role).
  none: '',
} as const;

// Stand-ins when a name is unknown.
export const FALLBACK_NAME = {
  actor: 'A team member',
  admin: 'An Admin',
  project: 'a project',
} as const;
