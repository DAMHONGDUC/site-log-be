import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import { ApiRoutes } from '../constants/api-routes.js';
import type { Guards } from '../http/guards.js';

// Leaving the company (01-api §5): any signed-in user, so a repeat after removal still answers.
export function accountRoutes(app: FastifyInstance, deps: AppDeps, guards: Guards): void {
  app.delete(ApiRoutes.ACCOUNT, { preHandler: guards.requireSignedIn }, async (request) => {
    const result = await deps.services.account.leave(request.uid);
    request.log.info({ uid: request.uid, ...result }, 'account deleted');
    return result;
  });
}
