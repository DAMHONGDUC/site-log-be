import { byName } from '../data/by-name.js';

// Who a caller is to the team (AccessService.lookup).
export const MEMBER_LOOKUPS = ['member', 'removed', 'unknown'] as const;
export const MEMBER_LOOKUP = byName(MEMBER_LOOKUPS);

// The reach of a role that sees every project.
export const REACH_ALL = 'all';

// What changed for a member, as the access push says it.
export const ACCESS_CHANGES = ['added', 'removed', 'role'] as const;
export const ACCESS_CHANGE = byName(ACCESS_CHANGES);

// What a caller wants to do with an object key.
export const FILE_ACCESS = { read: 'read', write: 'write' } as const;
export type FileAccess = (typeof FILE_ACCESS)[keyof typeof FILE_ACCESS];

// The invitation link the apps open: <INVITE_BASE_URL>/invite/<token>.
export const INVITE_PATH = '/invite/';
// What stands for the hidden part of an email in an invitation preview.
export const EMAIL_MASK = '••';
export const EMAIL_AT = '@';
