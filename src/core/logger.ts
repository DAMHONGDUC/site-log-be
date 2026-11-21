import { pino } from 'pino';

// One logger setup for the API (through Fastify) and the worker. Secrets never reach the logs.
export function loggerOptions(level: string) {
  return {
    level,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  };
}

export function createLogger(level: string) {
  return pino(loggerOptions(level));
}
