// Reads every setting from environment variables once, at startup.

export interface Config {
  nodeEnv: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  databaseSslCaPath: string | undefined;
  pgPoolMax: number;
  awsRegion: string;
  s3Bucket: string;
  firebaseServiceAccountBase64: string | undefined;
  presignTtlSeconds: number;
  singlePutThresholdBytes: number;
  partSizeBytes: number;
  maxUploadBytes: number;
  maxRequestBytes: number;
  pullPageSizeMax: number;
  pushBatchMax: number;
  tombstoneRetentionDays: number;
  verifyMinDelayMs: number;
  verifyRateLimitPerMinute: number;
  uploadRateLimitPerMinute: number;
  maxSocketsPerUser: number;
  // F19: invitations and the site clock
  inviteBaseUrl: string;
  inviteFromEmail: string | undefined;
  inviteTtlDays: number;
  siteTimeZone: string;
  invitePreviewRateLimitPerMinute: number;
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function optional(env: Env, name: string): string | undefined {
  const value = env[name];
  if (value === undefined || value === '') {
    return undefined;
  }
  return value;
}

function integer(env: Env, name: string, fallback: number): number {
  const text = optional(env, name);
  if (text === undefined) {
    return fallback;
  }
  const value = Number(text);
  if (!Number.isInteger(value)) {
    throw new Error(`Environment variable ${name} must be a whole number, got "${text}"`);
  }
  return value;
}

export function loadConfig(env: Env = process.env): Config {
  return {
    nodeEnv: optional(env, 'NODE_ENV') ?? 'development',
    port: integer(env, 'PORT', 3000),
    logLevel: optional(env, 'LOG_LEVEL') ?? 'info',
    databaseUrl: required(env, 'DATABASE_URL'),
    databaseSslCaPath: optional(env, 'DATABASE_SSL_CA_PATH'),
    pgPoolMax: integer(env, 'PG_POOL_MAX', 10),
    awsRegion: required(env, 'AWS_REGION'),
    s3Bucket: required(env, 'S3_BUCKET'),
    firebaseServiceAccountBase64: optional(env, 'FIREBASE_SERVICE_ACCOUNT_BASE64'),
    presignTtlSeconds: integer(env, 'PRESIGN_TTL_SECONDS', 3600),
    singlePutThresholdBytes: integer(env, 'SINGLE_PUT_THRESHOLD_BYTES', 5 * 1024 * 1024),
    partSizeBytes: integer(env, 'PART_SIZE_BYTES', 8 * 1024 * 1024),
    maxUploadBytes: integer(env, 'MAX_UPLOAD_BYTES', 20 * 1024 * 1024 * 1024),
    maxRequestBytes: integer(env, 'MAX_REQUEST_BYTES', 1024 * 1024),
    pullPageSizeMax: integer(env, 'PULL_PAGE_SIZE_MAX', 500),
    pushBatchMax: integer(env, 'PUSH_BATCH_MAX', 200),
    tombstoneRetentionDays: integer(env, 'TOMBSTONE_RETENTION_DAYS', 90),
    verifyMinDelayMs: integer(env, 'VERIFY_MIN_DELAY_MS', 300),
    verifyRateLimitPerMinute: integer(env, 'VERIFY_RATE_LIMIT_PER_MINUTE', 30),
    uploadRateLimitPerMinute: integer(env, 'UPLOAD_RATE_LIMIT_PER_MINUTE', 600),
    maxSocketsPerUser: integer(env, 'MAX_SOCKETS_PER_USER', 5),
    inviteBaseUrl: optional(env, 'INVITE_BASE_URL') ?? 'https://app.sitelog.example',
    inviteFromEmail: optional(env, 'INVITE_FROM_EMAIL'),
    inviteTtlDays: integer(env, 'INVITE_TTL_DAYS', 7),
    siteTimeZone: optional(env, 'SITE_TIME_ZONE') ?? 'Asia/Ho_Chi_Minh',
    invitePreviewRateLimitPerMinute: integer(env, 'INVITE_PREVIEW_RATE_LIMIT_PER_MINUTE', 30),
  };
}
