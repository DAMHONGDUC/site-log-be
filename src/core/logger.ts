import { pino } from 'pino';
import { HTTP_HEADER } from '../constants/platform/external.js';

// One logger setup for the API (through Fastify) and the worker. Secrets never reach the logs.
export function loggerOptions(level: string) {
  return {
    level,
    redact: [...HTTP_HEADER.redacted],
  };
}

export function createLogger(level: string) {
  return pino(loggerOptions(level));
}
