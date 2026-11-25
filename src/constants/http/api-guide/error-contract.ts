// The error contract (01-api §2): every error code, its status, and what the app does with it.
import { ErrorCode } from '../error-codes.js';
import { HTTP_STATUS } from '../http-status.js';
import { md } from './markdown.js';

export const ERROR_CONTRACT = [
  {
    status: HTTP_STATUS.badRequest,
    app: 'Permanent: **abort the job**',
    when: 'Malformed body, bad key, wrong size, missing parts',
    codes: [
      ErrorCode.invalidBody,
      ErrorCode.badRequest,
      ErrorCode.invalidKey,
      ErrorCode.invalidParts,
      ErrorCode.sizeMismatch,
      ErrorCode.invalidEmail,
      ErrorCode.invalidRole,
    ],
  },
  {
    status: HTTP_STATUS.unauthorized,
    app: 'Refresh the token once, retry; `member_removed` → sign out',
    when: 'Missing, expired, revoked or malformed token (never `403`); member removed',
    codes: [ErrorCode.missingToken, ErrorCode.invalidToken, ErrorCode.memberRemoved],
  },
  {
    status: HTTP_STATUS.forbidden,
    app: 'Permanent: show "not allowed", do not retry',
    when: 'The role may not do this or the project is not reachable; signed in but not a member',
    codes: [ErrorCode.forbidden, ErrorCode.notInvited],
  },
  {
    status: HTTP_STATUS.notFound,
    app: 'Permanent',
    when: 'Unknown or aborted upload, nothing uploaded, unknown code, member, project, invite or route',
    codes: [
      ErrorCode.routeNotFound,
      ErrorCode.uploadNotFound,
      ErrorCode.objectNotFound,
      ErrorCode.codeNotFound,
      ErrorCode.memberNotFound,
      ErrorCode.projectNotFound,
      ErrorCode.inviteNotFound,
    ],
  },
  {
    status: HTTP_STATUS.conflict,
    app: '`already_completed` on `complete` = success (body carries the stored result); others: show the reason',
    when: 'Same key completed by another upload; invite already used, expired or accepted; last Admin',
    codes: [
      ErrorCode.alreadyCompleted,
      ErrorCode.alreadyMember,
      ErrorCode.inviteUsed,
      ErrorCode.inviteExpired,
      ErrorCode.inviteAccepted,
      ErrorCode.emailMismatch,
      ErrorCode.lastAdmin,
    ],
  },
  {
    status: HTTP_STATUS.payloadTooLarge,
    app: 'Permanent',
    when: 'Body over 1 MiB, file over the upload limit',
    codes: [ErrorCode.bodyTooLarge, ErrorCode.fileTooLarge],
  },
  {
    status: HTTP_STATUS.tooManyRequests,
    app: 'Transient: wait, then retry',
    when: 'Rate limit',
    codes: [ErrorCode.rateLimited],
  },
  {
    status: HTTP_STATUS.internalError,
    app: 'Transient: retry with backoff',
    when: 'Server fault',
    codes: [ErrorCode.internal],
  },
  {
    status: HTTP_STATUS.serviceUnavailable,
    app: 'Transient: retry with backoff',
    when: 'Firebase cannot be reached to check the token',
    codes: [ErrorCode.authUnavailable],
  },
] as const;

const ERROR_SHAPE = { error: { code: ErrorCode.invalidKey, message: 'Key has the wrong shape' } };

export const ERROR_CONTRACT_SECTION = md.details(
  'Error contract: every error code and what the app does',
  `Every error has one shape, never a stack trace: ${md.json(ERROR_SHAPE)}`,
  md.table(
    ['Status', 'Codes', 'The app', 'Sent for'],
    ERROR_CONTRACT.map(({ status, codes, app, when }) => [
      md.code(status),
      codes.map(md.code).join(' '),
      app,
      when,
    ]),
  ),
  md.list([
    `${md.code(HTTP_STATUS.ok)} includes a repeated ${md.code('complete')} or ${md.code('DELETE')}: both are safe to retry.`,
    `A ${md.code(HTTP_STATUS.forbidden)} from **S3** on a presigned URL (XML body) means the URL expired; a ${md.code(HTTP_STATUS.forbidden)} from the **API** (JSON ${md.code('error')} body) means the role or project access says no.`,
  ]),
);
