// Size and count limits of request bodies and pages. Limits that the apps must match
// (pull page, push batch, part size) live in Config, set by environment.
export const LIMITS = {
  objectKeyMaxLength: 300,
  mediaKeysPerRequest: 200,
  partsPerRefresh: 1000,
  // S3 allows at most 10,000 parts per upload.
  s3MaxParts: 10_000,
  verificationCodeMinLength: 10,
  verificationCodeMaxLength: 16,
  syncTableNameMaxLength: 64,
  sha256HexLength: 64,
  emailMinLength: 3,
  emailMaxLength: 254,
  projectsPerInvite: 200,
  membersPerProject: 500,
  pushKindsPerDevice: 10,
  memberEventsPageDefault: 50,
  memberEventsPageMax: 100,
  websocketMaxPayloadBytes: 64 * 1024,
  dueSoonTitlesInBody: 2,
} as const;

// Shapes checked on the way in.
export const PATTERNS = {
  firebaseUid: '^[A-Za-z0-9]{1,128}$',
  fcmToken: '^[A-Za-z0-9_:-]{20,4096}$',
  // 32 random bytes, base64url.
  inviteToken: '^[A-Za-z0-9_-]{43}$',
  sha256Hex: '^[0-9a-f]{64}$',
  contentType: '^[a-z]+/[a-z0-9.+-]+$',
  eventCursor: '^[0-9]{1,18}$',
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
} as const;
