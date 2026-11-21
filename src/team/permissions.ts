// The permission table of 05-team-and-roles §3 as data. The server enforces every row;
// the apps only hide what a role cannot do.

export type Role = 'admin' | 'manager' | 'inspector' | 'viewer';

export const ROLES: Role[] = ['admin', 'manager', 'inspector', 'viewer'];

export type Action =
  | 'project.create'
  | 'project.edit'
  | 'project.delete'
  | 'project.members'
  | 'location.edit'
  | 'plan.edit'
  | 'session.write'
  | 'capture.write'
  | 'capture.delete'
  | 'issue.write'
  | 'issue.delete'
  | 'markup.write'
  | 'checklist.run'
  | 'template.edit'
  | 'branding.edit'
  | 'phrase.write'
  | 'members.read'
  | 'team.manage';

const MANAGER_NOT: Action[] = ['project.delete', 'team.manage'];
const INSPECTOR: Action[] = [
  'session.write',
  'capture.write',
  'capture.delete',
  'issue.write',
  'issue.delete',
  'markup.write',
  'checklist.run',
  'phrase.write',
];
// Inspectors may delete only what they made today (site time zone): evidence stays.
const OWN_SAME_DAY: Action[] = ['capture.delete', 'issue.delete'];

export interface PermissionContext {
  // The row was created by the caller, today in the site time zone.
  ownSameDay?: boolean;
}

export function can(role: Role, action: Action, context: PermissionContext = {}): boolean {
  if (role === 'admin') {
    return true;
  }
  if (role === 'manager') {
    return !MANAGER_NOT.includes(action);
  }
  if (role === 'inspector') {
    if (!INSPECTOR.includes(action)) {
      return false;
    }
    if (OWN_SAME_DAY.includes(action)) {
      return context.ownSameDay === true;
    }
    return true;
  }
  // Viewers read; the only thing they write is their own phrase list.
  return action === 'phrase.write';
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as string[]).includes(value);
}
