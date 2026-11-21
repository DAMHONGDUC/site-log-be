import { createHash, randomBytes } from 'node:crypto';
import type { Config } from '../config.js';
import type { MailMessage } from '../mail/mailer.js';
import type { Role } from './permissions.js';

// 32 random bytes, base64url: 43 characters. Only its SHA-256 is stored.
export const TOKEN_PATTERN = '^[A-Za-z0-9_-]{43}$';

export function newInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

// "vu@eastline.vn" → "v••@eastline.vn": the preview never shows the whole address.
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}••@${domain}`;
}

const ROLE_NAME: Record<Role, string> = {
  admin: 'Admin',
  manager: 'Manager',
  inspector: 'Inspector',
  viewer: 'Viewer',
};

export function inviteMail(
  config: Config,
  to: string,
  inviterName: string,
  role: Role,
  token: string,
): MailMessage {
  const link = `${config.inviteBaseUrl.replace(/\/$/, '')}/invite/${token}`;
  return {
    to,
    subject: 'You are invited to SiteLog',
    text: [
      `${inviterName || 'An Admin'} invited you to join SiteLog as ${ROLE_NAME[role]}.`,
      '',
      `Open this link on your phone: ${link}`,
      '',
      `The link works once and expires in ${config.inviteTtlDays} days.`,
    ].join('\n'),
  };
}
