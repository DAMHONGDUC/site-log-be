// Every `error.code` the API answers with (01-api §2). The apps switch on these strings.
export const ErrorCode = {
  // 400
  invalidBody: 'invalid_body',
  badRequest: 'bad_request',
  invalidKey: 'invalid_key',
  invalidParts: 'invalid_parts',
  sizeMismatch: 'size_mismatch',
  invalidEmail: 'invalid_email',
  invalidRole: 'invalid_role',
  // 401
  missingToken: 'missing_token',
  invalidToken: 'invalid_token',
  memberRemoved: 'member_removed',
  // 403
  forbidden: 'forbidden',
  notInvited: 'not_invited',
  // 404
  routeNotFound: 'route_not_found',
  uploadNotFound: 'upload_not_found',
  objectNotFound: 'object_not_found',
  codeNotFound: 'code_not_found',
  memberNotFound: 'member_not_found',
  projectNotFound: 'project_not_found',
  inviteNotFound: 'invite_not_found',
  // 409
  alreadyCompleted: 'already_completed',
  alreadyMember: 'already_member',
  inviteUsed: 'invite_used',
  inviteExpired: 'invite_expired',
  inviteAccepted: 'invite_accepted',
  emailMismatch: 'email_mismatch',
  lastAdmin: 'last_admin',
  // 413, 429, 5xx
  fileTooLarge: 'file_too_large',
  bodyTooLarge: 'body_too_large',
  rateLimited: 'rate_limited',
  authUnavailable: 'auth_unavailable',
  internal: 'internal',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// Sync push rejections (01-api §6.2): `rejected` with one of these reasons.
export const RejectReason = {
  unknownTable: 'unknown_table',
  missingParent: 'missing_parent',
  forbidden: 'forbidden',
  unknownField: (field: string) => `unknown_field:${field}`,
  invalidRow: (pgCode: string) => `invalid_row:${pgCode}`,
  forbiddenAction: (action: string) => `forbidden:${action}`,
} as const;
