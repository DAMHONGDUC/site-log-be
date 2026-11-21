import {
  OWN_SAME_DAY_ONLY,
  ROLE_PERMISSIONS,
  ROLES,
  type Action,
  type Role,
} from '../../constants/roles.js';

export interface PermissionContext {
  // The row was created by the caller, today in the site time zone.
  ownSameDay?: boolean;
}

// The permission table of 05-team-and-roles §3 (data in constants/roles.ts).
export function can(role: Role, action: Action, context: PermissionContext = {}): boolean {
  if (!ROLE_PERMISSIONS[role].includes(action)) {
    return false;
  }
  if (OWN_SAME_DAY_ONLY[role]?.includes(action)) {
    return context.ownSameDay === true;
  }
  return true;
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
