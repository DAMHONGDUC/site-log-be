import type { FastifyError, FastifyInstance } from 'fastify';
import { ErrorCode } from './constants/error-codes.js';
import { CLIENT_ERROR_RANGE, HTTP_STATUS } from './constants/http-status.js';

// The error contract: every error is { "error": { "code", "message" } }, never a stack trace.
// The iOS app aborts an upload on HTTP_STATUS.badRequest and HTTP_STATUS.notFound, so those are only for permanent problems.
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
  return new AppError(HTTP_STATUS.badRequest, code, message);
}

export function unauthorized(code: string): AppError {
  return new AppError(HTTP_STATUS.unauthorized, code, 'Sign in again');
}

export function forbidden(
  code: string = ErrorCode.forbidden,
  message = 'Not allowed for your role',
): AppError {
  return new AppError(HTTP_STATUS.forbidden, code, message);
}

export function notFound(code: string, message: string): AppError {
  return new AppError(HTTP_STATUS.notFound, code, message);
}

export function conflict(code: string, message: string, extra?: Record<string, unknown>): AppError {
  return new AppError(HTTP_STATUS.conflict, code, message, extra);
}

export function serviceUnavailable(code: string): AppError {
  return new AppError(HTTP_STATUS.serviceUnavailable, code, 'Try again later');
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
      return reply
        .status(HTTP_STATUS.badRequest)
        .send(errorBody(ErrorCode.invalidBody, error.message));
    }
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply
        .status(HTTP_STATUS.payloadTooLarge)
        .send(errorBody(ErrorCode.bodyTooLarge, 'Request body is too large'));
    }
    if (error.statusCode === HTTP_STATUS.tooManyRequests) {
      return reply
        .status(HTTP_STATUS.tooManyRequests)
        .send(errorBody(ErrorCode.rateLimited, 'Too many requests'));
    }
    if (
      error.statusCode !== undefined &&
      error.statusCode >= CLIENT_ERROR_RANGE.from &&
      error.statusCode < CLIENT_ERROR_RANGE.below
    ) {
      // Malformed JSON, wrong content type and similar client mistakes.
      request.log.warn({ code: error.code }, 'bad request');
      return reply
        .status(HTTP_STATUS.badRequest)
        .send(errorBody(ErrorCode.badRequest, error.message));
    }
    request.log.error({ err: error }, 'unexpected error');
    return reply
      .status(HTTP_STATUS.internalError)
      .send(errorBody(ErrorCode.internal, 'Something went wrong'));
  });

  app.setNotFoundHandler((request, reply) => {
    request.log.warn({ url: request.url }, 'route not found');
    return reply
      .status(HTTP_STATUS.notFound)
      .send(errorBody(ErrorCode.routeNotFound, 'No such route'));
  });
}
