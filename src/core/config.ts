import { NODE_ENVS } from '../constants/runtime/environments.js';
import { ENV, ENV_DEFAULT } from '../constants/runtime/env.js';
import { FAULT_TEXT } from '../constants/messages/error-text.js';

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
  // A local S3-compatible server (development only); unset means AWS S3.
  s3Endpoint: string | undefined;
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
    throw new Error(FAULT_TEXT.missingEnv(name));
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
    throw new Error(FAULT_TEXT.notInteger(name, text));
  }

  return value;
}

export function loadConfig(env: Env = process.env): Config {
  const config: Config = {
    nodeEnv: optional(env, ENV.nodeEnv) ?? NODE_ENVS.development,
    port: integer(env, ENV.port, 3000),
    logLevel: optional(env, ENV.logLevel) ?? ENV_DEFAULT.logLevel,
    databaseUrl: required(env, ENV.databaseUrl),
    databaseSslCaPath: optional(env, ENV.databaseSslCaPath),
    pgPoolMax: integer(env, ENV.pgPoolMax, 10),
    awsRegion: required(env, ENV.awsRegion),
    s3Bucket: required(env, ENV.s3Bucket),
    s3Endpoint: optional(env, ENV.s3Endpoint),
    firebaseServiceAccountBase64: optional(env, ENV.firebaseServiceAccount),
    presignTtlSeconds: integer(env, ENV.presignTtlSeconds, 3600),
    singlePutThresholdBytes: integer(env, ENV.singlePutThresholdBytes, 5 * 1024 * 1024),
    partSizeBytes: integer(env, ENV.partSizeBytes, 8 * 1024 * 1024),
    maxUploadBytes: integer(env, ENV.maxUploadBytes, 20 * 1024 * 1024 * 1024),
    maxRequestBytes: integer(env, ENV.maxRequestBytes, 1024 * 1024),
    pullPageSizeMax: integer(env, ENV.pullPageSizeMax, 500),
    pushBatchMax: integer(env, ENV.pushBatchMax, 200),
    tombstoneRetentionDays: integer(env, ENV.tombstoneRetentionDays, 90),
    verifyMinDelayMs: integer(env, ENV.verifyMinDelayMs, 300),
    verifyRateLimitPerMinute: integer(env, ENV.verifyRateLimitPerMinute, 30),
    uploadRateLimitPerMinute: integer(env, ENV.uploadRateLimitPerMinute, 600),
    maxSocketsPerUser: integer(env, ENV.maxSocketsPerUser, 5),
    inviteBaseUrl: optional(env, ENV.inviteBaseUrl) ?? ENV_DEFAULT.inviteBaseUrl,
    inviteFromEmail: optional(env, ENV.inviteFromEmail),
    inviteTtlDays: integer(env, ENV.inviteTtlDays, 7),
    siteTimeZone: optional(env, ENV.siteTimeZone) ?? ENV_DEFAULT.siteTimeZone,
    invitePreviewRateLimitPerMinute: integer(env, ENV.invitePreviewRateLimitPerMinute, 30),
  };

  if (config.nodeEnv === NODE_ENVS.production && config.s3Endpoint !== undefined) {
    throw new Error(FAULT_TEXT.s3EndpointInProduction);
  }

  return config;
}
