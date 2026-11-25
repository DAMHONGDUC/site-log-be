// HTTP status codes the API answers with.
export const HTTP_STATUS = {
  ok: 200,
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  payloadTooLarge: 413,
  tooManyRequests: 429,
  internalError: 500,
  serviceUnavailable: 503,
} as const;

// 4xx: the client's mistake.
export const CLIENT_ERROR_RANGE = { from: 400, below: 500 } as const;

// The body of /health.
export const HEALTH_STATUS = { ok: 'ok', databaseUnreachable: 'database_unreachable' } as const;
