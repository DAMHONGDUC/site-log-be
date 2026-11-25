import { FALLBACK_NAME } from '../../../constants/domain/push.js';
import { ROLE_LABEL, type Role } from '../../../constants/domain/roles.js';
import type { MailMessage } from '../../../integrations/mailer.js';
import { INVITE_MAIL_TEXT } from '../../../constants/messages/mail-text.js';
import { NEWLINE } from '../../../constants/platform/encoding.js';
import { INVITE_PATH } from '../../../constants/domain/team.js';

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
    subject: INVITE_MAIL_TEXT.subject,
    text: [
      INVITE_MAIL_TEXT.intro(input.inviterName || FALLBACK_NAME.admin, ROLE_LABEL[input.role]),
      '',
      INVITE_MAIL_TEXT.link(input.link),
      '',
      INVITE_MAIL_TEXT.expiry(input.ttlDays),
    ].join(NEWLINE),
  };
}
