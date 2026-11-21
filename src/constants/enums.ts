import { byName } from './by-name.js';

// Values of the Postgres enums and checked text columns, shared by the schema and the code.

export const SESSION_STATES = ['draft', 'active', 'closed', 'exported'] as const;
export const SESSION_STATE = byName(SESSION_STATES);

export const UPLOAD_MODES = ['single', 'multipart'] as const;
export const UPLOAD_MODE = byName(UPLOAD_MODES);
export type UploadMode = (typeof UPLOAD_MODES)[number];

export const UPLOAD_STATES = ['created', 'completed', 'aborted'] as const;
export const UPLOAD_STATE = byName(UPLOAD_STATES);
export type UploadState = (typeof UPLOAD_STATES)[number];

export const VERIFY_STATES = ['registered', 'verified', 'mismatch'] as const;
export const VERIFY_STATE = byName(VERIFY_STATES);
export type VerifyState = (typeof VERIFY_STATES)[number];

export const DEVICE_PLATFORMS = ['ios', 'android'] as const;
export const DEVICE_PLATFORM = byName(DEVICE_PLATFORMS);
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const MEMBER_EVENT_TYPES = [
  'invited',
  'invite_resent',
  'invite_cancelled',
  'joined',
  'role_changed',
  'projects_changed',
  'removed',
  'account_deleted',
] as const;
export const MEMBER_EVENT_TYPE = byName(MEMBER_EVENT_TYPES);
export type MemberEventType = (typeof MEMBER_EVENT_TYPES)[number];
