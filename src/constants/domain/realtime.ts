import { byName } from '../data/by-name.js';

// The /ws protocol (01-api §11) and the Postgres channel the realtime hub listens on.

export const WS_MESSAGE = {
  auth: 'auth',
  subscribe: 'subscribe',
  ping: 'ping',
  pong: 'pong',
  snapshot: 'snapshot',
  jobCompleted: 'jobCompleted',
  jobFailed: 'jobFailed',
} as const;

// Why a job failed, as the apps read it.
export const JOB_FAILURE = { aborted: 'aborted', integrity: 'integrity' } as const;

export const WS_CLOSE_REASON = {
  authTimeout: 'auth timeout',
  missingToken: 'missing token',
  notMember: 'not a member',
  tooManySockets: 'too many sockets',
  tokenExpired: 'token expired',
  invalidToken: 'invalid token',
  forbidden: 'forbidden',
  authFirst: 'auth first',
} as const;

// Events of a socket and of the LISTEN connection.
export const SOCKET_EVENT = {
  message: 'message',
  close: 'close',
  error: 'error',
  notification: 'notification',
} as const;

export const UPLOAD_EVENTS_CHANNEL = 'upload_events';
export const UPLOAD_EVENTS_LISTEN = `listen ${UPLOAD_EVENTS_CHANNEL}`;

// What happened to an upload, as one API process tells the others.
export const UPLOAD_EVENT_TYPES = ['completed', 'aborted', 'verified', 'mismatch'] as const;
export const UPLOAD_EVENT = byName(UPLOAD_EVENT_TYPES);
export type UploadEventType = (typeof UPLOAD_EVENT_TYPES)[number];
