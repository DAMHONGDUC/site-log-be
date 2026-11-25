// The flows that span several routes (03-sync-uploads-realtime): what each route list entry
// is a step of, and in which order the app calls them.
import { ApiRoutes } from '../api-routes.js';
import { ErrorCode } from '../error-codes.js';
import { HTTP_STATUS } from '../http-status.js';
import { MUTATION_OP, MUTATION_STATUS } from '../../data/sync.js';
import { UPLOAD_MODE } from '../../data/enums.js';
import { JOB_FAILURE, WS_MESSAGE } from '../../domain/realtime.js';
import { md } from './markdown.js';

const SYNC_PULL = md.blocks(
  md.heading(`Sync: pull ${md.path(ApiRoutes.SYNC_PULL)}`),
  md.steps([
    `Send ${md.json({ since: 0, limit: 500 })}: ${md.code('since')} is the ${md.code('nextRev')} of the last pull, ${md.code(0)} for a full download.`,
    `Apply ${md.code('changes')} per table. A row with ${md.code('deletedAt')} set is a tombstone: delete it locally.`,
    `${md.code('hasMore: true')} → pull again at once with ${md.code('since = nextRev')}.`,
    `${md.code('resyncRequired: true')} → the cursor is older than the tombstone purge, or your access changed: wipe synced data and pull from ${md.code(0)}.`,
  ]),
  `Every row carries a company-wide ${md.code('rev')} (one counter, locked per push), so no change is ever skipped, whatever the device clocks say.`,
);

const SYNC_PUSH = md.blocks(
  md.heading(`Sync: push ${md.path(ApiRoutes.SYNC_PUSH)}`),
  md.steps([
    `Send up to 200 ${md.code('mutations')}, parents first. ${md.code(MUTATION_OP.upsert)} sends the **full row** in ${md.code('fields')}; ${md.code(MUTATION_OP.delete)} sends ${md.code('{}')}.`,
    `The batch runs in one transaction; each mutation gets its own result.`,
    `The last write wins by ${md.code('clientUpdatedAt')}; a delete wins a tie; a deleted row never comes back.`,
  ]),
  md.table(
    ['Result', 'Meaning', 'The app'],
    [
      [md.code(MUTATION_STATUS.applied), 'Stored', 'Mark the mutation done'],
      [
        md.code(MUTATION_STATUS.superseded),
        'The server holds a newer row, a tombstone, or a row with the same natural key',
        `Replace the local row with ${md.code('serverRow')} (its ${md.code('id')} may differ)`,
      ],
      [
        md.code(MUTATION_STATUS.rejected),
        `Can never be stored as sent: ${md.code('reason')} says why (${md.code('missing_parent')}, ${md.code('forbidden:<action>')}, ${md.code('invalid_row:<code>')}…)`,
        `Drop the mutation, log ${md.code('reason')}`,
      ],
    ],
  ),
);

const UPLOAD = md.blocks(
  md.heading('Upload a file'),
  `The API never sees the bytes: the app PUTs them straight to S3 on presigned URLs.`,
  md.steps([
    `${md.path(ApiRoutes.UPLOADS)} with ${md.code('key')}, ${md.code('byteSize')}, ${md.code('contentType')}, ${md.code('sha256')}. Under 5 MiB → ${md.code(UPLOAD_MODE.single)} (one URL); from 5 MiB → ${md.code(UPLOAD_MODE.multipart)} (8 MiB parts, every part URL at once).`,
    `PUT the bytes (or each part) to S3 with ${md.code('Content-Type')} equal to ${md.code('contentType')}. Keep each part's ${md.code('ETag')} header.`,
    `A ${md.code(HTTP_STATUS.forbidden)} from S3 = the URL expired: ${md.path(ApiRoutes.UPLOAD_PARTS_REFRESH)} for the parts still to send (multipart), or begin again (single).`,
    `${md.path(ApiRoutes.UPLOAD_COMPLETE)}: ${md.code('{}')} for single, every part's ${md.code('etag')} for multipart. The server checks the object in S3, records the hash and returns ${md.code('remoteKey')} and ${md.code('verificationCode')}.`,
    `To give up: ${md.code('DELETE')} ${md.path(ApiRoutes.UPLOAD)}.`,
  ]),
  md.list([
    `${md.code('complete')} is idempotent: a retry after a lost response returns the same body.`,
    `${md.code(`${HTTP_STATUS.conflict} ${ErrorCode.alreadyCompleted}`)} → another upload of the same key won; its body carries the stored result: treat as success.`,
    `${md.code(`${HTTP_STATUS.notFound} ${ErrorCode.objectNotFound}`)} → nothing reached S3; ${md.code(`${HTTP_STATUS.badRequest} ${ErrorCode.sizeMismatch}`)} → the stored size differs from ${md.code('byteSize')}.`,
  ]),
);

const INTEGRITY = md.blocks(
  md.heading('Integrity: from registered to verified'),
  md.table(
    ['Step', 'Who', 'What it proves'],
    [
      [
        md.code('registered'),
        md.code('complete'),
        'This account registered this hash at this time',
      ],
      [
        md.code('verified'),
        'Worker re-reads the object and recomputes SHA-256',
        'The stored bytes hash to this value',
      ],
      [
        md.code('mismatch'),
        'Worker hash differs',
        `${md.code(`${WS_MESSAGE.jobFailed}(${JOB_FAILURE.integrity})`)} to the app`,
      ],
    ],
  ),
  `${md.code('verified')} turns ${md.code('true')} later: the app learns it from the WebSocket (${md.code(WS_MESSAGE.jobCompleted)}) or by pulling.`,
);

export const FLOWS_SECTION = md.details(
  'Flows: sync, uploads and integrity, step by step',
  SYNC_PULL,
  SYNC_PUSH,
  UPLOAD,
  INTEGRITY,
);
