// Names and codes defined by the services and runtimes the server talks to.

export const FIREBASE_AUTH_ERROR = {
  // Every Firebase Auth error code starts with this.
  prefix: 'auth/',
  internal: 'auth/internal-error',
  userNotFound: 'auth/user-not-found',
} as const;

export const FCM = {
  appName: 'push',
  apnsSound: 'default',
  androidPriority: 'high',
  // The token is gone: forget it.
  deadTokenErrors: [
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
  ],
} as const;

export const S3 = {
  // Checksums only when the operation needs one (local S3 servers reject the rest).
  checksumWhenRequired: 'WHEN_REQUIRED',
  missingErrors: ['NotFound', 'NoSuchKey', 'NoSuchUpload'],
  // Joins the bucket and the key of a copy source.
  pathSeparator: '/',
} as const;

export const FASTIFY_ERROR = { bodyTooLarge: 'FST_ERR_CTP_BODY_TOO_LARGE' } as const;

// Postgres error codes: 23505 unique, 23503 foreign key, 22xxx bad value, 23xxx other rules.
export const PG_ERROR = {
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  badValueClass: '22',
  ruleClass: '23',
  // Constraint names Postgres gives a primary key.
  primaryKeySuffix: '_pkey',
} as const;

export const SIGNAL = { term: 'SIGTERM', interrupt: 'SIGINT' } as const;

export const HTTP_HEADER = {
  cacheControl: 'cache-control',
  noStore: 'no-store',
  bearerPrefix: 'Bearer ',
  // Never logged.
  redacted: ['req.headers.authorization', 'req.headers.cookie'],
} as const;
