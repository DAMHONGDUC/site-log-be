import { byName } from '../data/by-name.js';

// The four roles and the permission table of 05-team-and-roles §3, as data.

export const ROLES = ['admin', 'manager', 'inspector', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

// Each role by name, for code that means one role (`ROLE.admin`).
export const ROLE = byName(ROLES);

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

// Each action by name (`ACTION.teamManage` reads as 'team.manage').
export const ACTION = {
  projectCreate: 'project.create',
  projectEdit: 'project.edit',
  projectDelete: 'project.delete',
  projectMembers: 'project.members',
  locationEdit: 'location.edit',
  planEdit: 'plan.edit',
  sessionWrite: 'session.write',
  captureWrite: 'capture.write',
  captureDelete: 'capture.delete',
  issueWrite: 'issue.write',
  issueDelete: 'issue.delete',
  markupWrite: 'markup.write',
  checklistRun: 'checklist.run',
  templateEdit: 'template.edit',
  brandingEdit: 'branding.edit',
  phraseWrite: 'phrase.write',
  membersRead: 'members.read',
  teamManage: 'team.manage',
} as const satisfies Record<string, Action>;

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
