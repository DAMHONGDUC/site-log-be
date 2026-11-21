// The words of the invitation email.
export const INVITE_MAIL_TEXT = {
  subject: 'You are invited to SiteLog',
  intro: (inviter: string, role: string) => `${inviter} invited you to join SiteLog as ${role}.`,
  link: (link: string) => `Open this link on your phone: ${link}`,
  expiry: (ttlDays: number) => `The link works once and expires in ${ttlDays} days.`,
} as const;
