import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.js';
import { ApiRoutes } from '../../constants/http/api-routes.js';
import { HTTP_STATUS, HEALTH_STATUS } from '../../constants/http/http-status.js';
import { LOG } from '../../constants/messages/log.js';
import { HTTP_HEADER } from '../../constants/platform/external.js';

// Liveness for the load balancer, the deploy script and uptime alarms.
// The Date header doubles as the app's trusted clock, so nothing may cache this.
export function healthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get(ApiRoutes.HEALTH, async (request, reply) => {
    try {
      await deps.db.ping();
    } catch (error) {
      request.log.error({ err: error }, LOG.health.databaseUnreachable);
      return reply
        .status(HTTP_STATUS.serviceUnavailable)
        .send({ status: HEALTH_STATUS.databaseUnreachable });
    }
    reply.header(HTTP_HEADER.cacheControl, HTTP_HEADER.noStore);
    return { status: HEALTH_STATUS.ok };
  });
}
