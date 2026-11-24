import { createHash, randomBytes } from 'node:crypto';
import { ENCODING, HASH } from '../../../constants/platform/encoding.js';
import { EMAIL_AT, EMAIL_MASK } from '../../../constants/domain/team.js';

const TOKEN_BYTES = 32;
const VISIBLE_EMAIL_CHARACTERS = 1;

// 32 random bytes, base64url (43 characters). Only its SHA-256 is stored.
export function newInviteToken(): string {
  return randomBytes(TOKEN_BYTES).toString(ENCODING.base64url);
}

export function hashToken(token: string): Buffer {
  return createHash(HASH.sha256).update(token).digest();
}

// "vu@eastline.vn" → "v••@eastline.vn": the preview never shows the whole address.
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split(EMAIL_AT);

  return `${local.slice(0, VISIBLE_EMAIL_CHARACTERS)}${EMAIL_MASK}${EMAIL_AT}${domain}`;
}

// The name a member gets before they set one: the part before the @.
export function nameFromEmail(email: string): string {
  return email.split(EMAIL_AT)[0] ?? '';
}
