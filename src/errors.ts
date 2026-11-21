import type { FastifyError, FastifyInstance } from 'fastify';

// The error contract: every error is { "error": { "code", "message" } }, never a stack trace.
// The iOS app aborts an upload on 400 and 404, so those are only for permanent problems.
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly extra: Record<string, unknown> | undefined;

  constructor(statusCode: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.extra = extra;
  }
}

export function badRequest(code: string, message: string): AppError {
  return new AppError(400, code, message);
}

export function unauthorized(code: string): AppError {
  return new AppError(401, code, 'Sign in again');
}

export function notFound(code: string, message: string): AppError {
  return new AppError(404, code, message);
}

export function conflict(code: string, message: string, extra?: Record<string, unknown>): AppError {
  return new AppError(409, code, message, extra);
}

export function serviceUnavailable(code: string): AppError {
  return new AppError(503, code, 'Try again later');
}

export function errorBody(code: string, message: string, extra?: Record<string, unknown>) {
  return { error: { code, message, ...extra } };
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      request.log.warn({ code: error.code, status: error.statusCode }, 'request failed');
      return reply.status(error.statusCode).send(errorBody(error.code, error.message, error.extra));
    }
    if (error.validation !== undefined) {
      request.log.warn({ validation: error.message }, 'invalid body');
      return reply.status(400).send(errorBody('invalid_body', error.message));
    }
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.status(413).send(errorBody('body_too_large', 'Request body is too large'));
    }
    if (error.statusCode === 429) {
      return reply.status(429).send(errorBody('rate_limited', 'Too many requests'));
    }
    if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
      // Malformed JSON, wrong content type and similar client mistakes.
      request.log.warn({ code: error.code }, 'bad request');
      return reply.status(400).send(errorBody('bad_request', error.message));
    }
    request.log.error({ err: error }, 'unexpected error');
    return reply.status(500).send(errorBody('internal', 'Something went wrong'));
  });

  app.setNotFoundHandler((request, reply) => {
    request.log.warn({ url: request.url }, 'route not found');
    return reply.status(404).send(errorBody('route_not_found', 'No such route'));
  });
}
