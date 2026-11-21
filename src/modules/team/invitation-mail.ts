import { FALLBACK_NAME } from '../../constants/push.js';
import { ROLE_LABEL, type Role } from '../../constants/roles.js';
import type { MailMessage } from '../../integrations/mailer.js';

export const INVITE_PATH = '/invite/';

export function inviteLink(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, '')}${INVITE_PATH}${token}`;
}

export function inviteMail(input: {
  to: string;
  inviterName: string;
  role: Role;
  link: string;
  ttlDays: number;
}): MailMessage {
  return {
    to: input.to,
    subject: 'You are invited to SiteLog',
    text: [
      `${input.inviterName || FALLBACK_NAME.admin} invited you to join SiteLog as ${ROLE_LABEL[input.role]}.`,
      '',
      `Open this link on your phone: ${input.link}`,
      '',
      `The link works once and expires in ${input.ttlDays} days.`,
    ].join('\n'),
  };
}
