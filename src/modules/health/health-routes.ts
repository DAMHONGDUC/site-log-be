import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.js';
import { ApiRoutes } from '../../constants/http/api-routes.js';
import { HTTP_STATUS } from '../../constants/http/http-status.js';

// Liveness for the load balancer, the deploy script and uptime alarms.
// The Date header doubles as the app's trusted clock, so nothing may cache this.
export function healthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get(ApiRoutes.HEALTH, async (request, reply) => {
    try {
      await deps.db.ping();
    } catch (error) {
      request.log.error({ err: error }, 'health: database unreachable');
      return reply.status(HTTP_STATUS.serviceUnavailable).send({ status: 'database_unreachable' });
    }
    reply.header('cache-control', 'no-store');
    return { status: 'ok' };
  });
}
