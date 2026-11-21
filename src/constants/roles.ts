// The four roles and the permission table of 05-team-and-roles §3, as data.

export const ROLES = ['admin', 'manager', 'inspector', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  manager: 'Manager',
  inspector: 'Inspector',
  viewer: 'Viewer',
};

// Roles that reach every project without being added to it.
export const ROLES_REACHING_ALL: readonly Role[] = ['admin', 'manager'];

export const ACTIONS = [
  'project.create',
  'project.edit',
  'project.delete',
  'project.members',
  'location.edit',
  'plan.edit',
  'session.write',
  'capture.write',
  'capture.delete',
  'issue.write',
  'issue.delete',
  'markup.write',
  'checklist.run',
  'template.edit',
  'branding.edit',
  'phrase.write',
  'members.read',
  'team.manage',
] as const;
export type Action = (typeof ACTIONS)[number];

const FIELD_WORK: readonly Action[] = [
  'session.write',
  'capture.write',
  'capture.delete',
  'issue.write',
  'issue.delete',
  'markup.write',
  'checklist.run',
  'phrase.write',
];

// role → what it may do. A new role or action is one edit here.
export const ROLE_PERMISSIONS: Record<Role, readonly Action[]> = {
  admin: ACTIONS,
  manager: ACTIONS.filter((action) => action !== 'project.delete' && action !== 'team.manage'),
  inspector: FIELD_WORK,
  viewer: ['phrase.write'],
};

// For these roles, these actions are allowed only on a row they made today (site time zone):
// evidence stays once the day is over.
export const OWN_SAME_DAY_ONLY: Partial<Record<Role, readonly Action[]>> = {
  inspector: ['capture.delete', 'issue.delete'],
};
