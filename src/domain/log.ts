// The logging a service needs: Fastify's request or app logger, or the worker's pino logger.
export interface Log {
  info(object: object, message?: string): void;
  warn(object: object, message?: string): void;
  error(object: object, message?: string): void;
}
