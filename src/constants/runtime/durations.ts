// Every fixed duration of the server and the worker. Durations the operator may tune
// (presign TTL, invite TTL, retention) live in Config.

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const DURATIONS = {
  // Rate-limit window of every limited route.
  rateLimitWindow: '1 minute',
  // A verify claim older than this belongs to a crashed worker (Postgres interval).
  verifyClaimTimeout: '30 minutes',
  // Uploads begun this long ago and never completed are aborted (Postgres interval).
  abandonedUploadAfter: '7 days',
  // Worker cadence.
  workerIdleMs: 5 * SECOND_MS,
  abandonedCheckEveryMs: HOUR_MS,
  purgeEveryMs: DAY_MS,
  // Site hour of the daily "due tomorrow" push.
  dueSoonHour: 8,
  // Realtime.
  websocketAuthTimeoutMs: 5 * SECOND_MS,
  listenerReconnectMs: 5 * SECOND_MS,
} as const;
