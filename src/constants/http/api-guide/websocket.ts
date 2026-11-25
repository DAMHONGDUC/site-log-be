// The /ws protocol (01-api §11). Swagger cannot describe a WebSocket, so the route is hidden
// from the spec and documented here instead.
import { ApiRoutes } from '../api-routes.js';
import { JOB_FAILURE, WS_MESSAGE } from '../../domain/realtime.js';
import { WS_CLOSE } from '../../runtime/websocket.js';
import { DURATIONS } from '../../runtime/durations.js';
import { LIMITS } from '../../runtime/limits.js';
import { MS_PER_SECOND } from '../../runtime/units.js';
import { md } from './markdown.js';

// Standard close code the ws library sends on its own (RFC 6455).
const WS_STANDARD_CLOSE = { messageTooBig: 1009 } as const;

const BYTES_PER_KIB = 1024;
const AUTH_SECONDS = DURATIONS.websocketAuthTimeoutMs / MS_PER_SECOND;
const MAX_KIB = LIMITS.websocketMaxPayloadBytes / BYTES_PER_KIB;

const UUID = '<uuid>';
const UPLOAD_ID = '<uploadId>';
const REMOTE_KEY = '<remoteKey>';
const SHA256 = '<sha256>';
const PING_AT = 1764000000000;

const TO_SERVER = 'App → server';
const TO_APP = 'Server → app';

const MESSAGES = [
  [
    TO_SERVER,
    { type: WS_MESSAGE.auth, token: '<Firebase ID token>' },
    `**First**, within ${AUTH_SECONDS} s`,
  ],
  [TO_SERVER, { type: WS_MESSAGE.subscribe, sessionID: UUID }, 'Watch one capture session'],
  [TO_SERVER, { type: WS_MESSAGE.ping, at: PING_AT }, 'Keep-alive; any number'],
  [
    TO_APP,
    {
      type: WS_MESSAGE.snapshot,
      sessionID: UUID,
      completed: [{ jobID: UPLOAD_ID, remoteKey: REMOTE_KEY, sha256: SHA256, verified: true }],
      failed: [{ jobID: UPLOAD_ID, reason: JOB_FAILURE.integrity }],
    },
    `Always first after ${md.code(WS_MESSAGE.subscribe)}: the catch-up`,
  ],
  [
    TO_APP,
    {
      type: WS_MESSAGE.jobCompleted,
      jobID: UPLOAD_ID,
      remoteKey: REMOTE_KEY,
      sha256: SHA256,
      verified: false,
    },
    `After ${md.code('complete')}, and again with ${md.code('verified: true')} once the worker re-read the file`,
  ],
  [
    TO_APP,
    { type: WS_MESSAGE.jobFailed, jobID: UPLOAD_ID, reason: JOB_FAILURE.integrity },
    `${md.code(JOB_FAILURE.integrity)} (stored bytes differ) or ${md.code(JOB_FAILURE.aborted)}`,
  ],
  [TO_APP, { type: WS_MESSAGE.pong, at: PING_AT }, 'Same number as the ping'],
] as const;

const CLOSE_CODES = [
  [
    WS_CLOSE.authTimeout,
    `No ${md.code(WS_MESSAGE.auth)} within ${AUTH_SECONDS} s`,
    'Reconnect, send `auth` first',
  ],
  [
    WS_CLOSE.token,
    `Token missing, invalid or expired, or a message sent before ${md.code(WS_MESSAGE.auth)}`,
    'Refresh the token, reconnect',
  ],
  [
    WS_CLOSE.forbidden,
    "Not a member, or subscribed to another account's session",
    'Not a member: ask an Admin to invite you. Other session: bug, do not retry it',
  ],
  [WS_CLOSE.tooManySockets, 'Too many sockets for this account', 'Close older sockets'],
  [WS_STANDARD_CLOSE.messageTooBig, `Message over ${MAX_KIB} KiB`, 'Bug'],
] as const;

export const WEBSOCKET_SECTION = md.details(
  `WebSocket ${md.path(ApiRoutes.WEBSOCKET)}: realtime upload results`,
  md.list([
    `Connect to ${md.code(`wss://<host>${ApiRoutes.WEBSOCKET}`)} (${md.code(`ws://localhost:3000${ApiRoutes.WEBSOCKET}`)} locally). Not in the route list: Swagger cannot describe a WebSocket.`,
    `One JSON object per text frame, at most ${MAX_KIB} KiB.`,
    `The token goes in the first message only, never in the URL.`,
  ]),
  md.heading('Messages'),
  md.table(
    ['Direction', 'Message', 'When'],
    MESSAGES.map(([direction, message, when]) => [direction, md.json(message), when]),
  ),
  md.list([
    `${md.code('jobID')} is the ${md.code('uploadId')} from ${md.path(ApiRoutes.UPLOADS)}.`,
    `Trust ${md.code(WS_MESSAGE.jobCompleted)} only if its ${md.code('sha256')} equals the local hash.`,
    `Delivery is at most once: the ${md.code(WS_MESSAGE.snapshot)} after every ${md.code(WS_MESSAGE.subscribe)} is how the app catches up after a reconnect.`,
  ]),
  md.heading('Close codes'),
  md.table(
    ['Code', 'Meaning', 'The app'],
    CLOSE_CODES.map(([code, meaning, app]) => [md.code(code), meaning, app]),
  ),
);
