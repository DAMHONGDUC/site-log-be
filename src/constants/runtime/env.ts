// Every environment variable the server reads, and the text defaults (number defaults stay in
// core/config.ts next to the variable they belong to).
export const ENV = {
  nodeEnv: 'NODE_ENV',
  port: 'PORT',
  logLevel: 'LOG_LEVEL',
  databaseUrl: 'DATABASE_URL',
  databaseSslCaPath: 'DATABASE_SSL_CA_PATH',
  pgPoolMax: 'PG_POOL_MAX',
  awsRegion: 'AWS_REGION',
  s3Bucket: 'S3_BUCKET',
  s3Endpoint: 'S3_ENDPOINT',
  firebaseServiceAccount: 'FIREBASE_SERVICE_ACCOUNT_BASE64',
  presignTtlSeconds: 'PRESIGN_TTL_SECONDS',
  singlePutThresholdBytes: 'SINGLE_PUT_THRESHOLD_BYTES',
  partSizeBytes: 'PART_SIZE_BYTES',
  maxUploadBytes: 'MAX_UPLOAD_BYTES',
  maxRequestBytes: 'MAX_REQUEST_BYTES',
  pullPageSizeMax: 'PULL_PAGE_SIZE_MAX',
  pushBatchMax: 'PUSH_BATCH_MAX',
  tombstoneRetentionDays: 'TOMBSTONE_RETENTION_DAYS',
  verifyMinDelayMs: 'VERIFY_MIN_DELAY_MS',
  verifyRateLimitPerMinute: 'VERIFY_RATE_LIMIT_PER_MINUTE',
  uploadRateLimitPerMinute: 'UPLOAD_RATE_LIMIT_PER_MINUTE',
  maxSocketsPerUser: 'MAX_SOCKETS_PER_USER',
  inviteBaseUrl: 'INVITE_BASE_URL',
  inviteFromEmail: 'INVITE_FROM_EMAIL',
  inviteTtlDays: 'INVITE_TTL_DAYS',
  siteTimeZone: 'SITE_TIME_ZONE',
  invitePreviewRateLimitPerMinute: 'INVITE_PREVIEW_RATE_LIMIT_PER_MINUTE',
} as const;

export const ENV_DEFAULT = {
  logLevel: 'info',
  inviteBaseUrl: 'https://app.sitelog.example',
  siteTimeZone: 'Asia/Ho_Chi_Minh',
  // Listen on every interface (inside the container).
  host: '0.0.0.0',
} as const;
