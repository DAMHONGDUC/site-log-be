import type { FastifyPluginAsync } from 'fastify';
import { ApiRoutes } from '../../constants/http/api-routes.js';
import { LOG } from '../../constants/messages/log.js';

// Leaving the company (01-api §5): any signed-in user, so a repeat after removal still answers.
export const accountRoutes: FastifyPluginAsync = async (app) => {
  const { deps, guards } = app;

  app.delete(ApiRoutes.ACCOUNT, { preHandler: guards.requireSignedIn }, async (request) => {
    const result = await deps.services.account.leave(request.uid);

    request.log.info({ uid: request.uid, ...result }, LOG.account.deleted);

    return result;
  });
};
