import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';

// Liveness for the load balancer, the deploy script and uptime alarms.
// The Date header doubles as the app's trusted clock, so nothing may cache this.
export function healthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/health', async (request, reply) => {
    try {
      await deps.pool.query('select 1');
    } catch (error) {
      request.log.error({ err: error }, 'health: database unreachable');
      return reply.status(503).send({ status: 'database_unreachable' });
    }
    reply.header('cache-control', 'no-store');
    return { status: 'ok' };
  });
}
