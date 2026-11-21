import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.js';
import { ApiRoutes } from '../../constants/http/api-routes.js';
import { LIMITS } from '../../constants/runtime/limits.js';
import type { Guards } from '../../core/http/guards.js';
import { pullChanges } from './pull.js';
import { pushMutations } from './push/index.js';
import { LOG } from '../../constants/messages/log.js';
import { JSON_FORMAT } from '../../constants/http/openapi.js';
import { MUTATION_OPS, MUTATION_STATUS } from '../../constants/data/sync.js';

export function syncRoutes(app: FastifyInstance, deps: AppDeps, guards: Guards): void {
  const { requireUser } = guards;
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  const PullBody = Type.Object({
    since: Type.Integer({ minimum: 0 }),
    limit: Type.Integer({ minimum: 1, maximum: deps.config.pullPageSizeMax }),
  });

  typed.post(
    ApiRoutes.SYNC_PULL,
    { preHandler: requireUser, schema: { body: PullBody } },
    async (request) => {
      const started = Date.now();
      const result = await pullChanges(
        deps.pool,
        deps.db.repos,
        deps.services.access,
        request.member,
        request.body.since,
        request.body.limit,
      );
      if (result.resyncRequired) {
        request.log.info({ uid: request.uid, since: request.body.since }, LOG.sync.pullResync);
        return { resyncRequired: true };
      }
      let pulled = 0;
      for (const rows of Object.values(result.changes)) {
        pulled += rows.length;
      }
      request.log.info(
        {
          uid: request.uid,
          since: request.body.since,
          pulled,
          nextRev: result.nextRev,
          elapsedMs: Date.now() - started,
        },
        LOG.sync.pull,
      );
      return { changes: result.changes, nextRev: result.nextRev, hasMore: result.hasMore };
    },
  );

  const Mutation = Type.Object({
    table: Type.String({ minLength: 1, maxLength: LIMITS.syncTableNameMaxLength }),
    id: Type.String({ format: JSON_FORMAT.uuid }),
    op: Type.Union(MUTATION_OPS.map((op) => Type.Literal(op))),
    clientUpdatedAt: Type.String({ format: JSON_FORMAT.dateTime }),
    fields: Type.Record(Type.String(), Type.Unknown()),
  });
  const PushBody = Type.Object({
    mutations: Type.Array(Mutation, { minItems: 1, maxItems: deps.config.pushBatchMax }),
  });

  typed.post(
    ApiRoutes.SYNC_PUSH,
    { preHandler: requireUser, schema: { body: PushBody } },
    async (request) => {
      const started = Date.now();
      const outcome = await pushMutations(
        deps.pool,
        {
          member: request.member,
          siteTimeZone: deps.config.siteTimeZone,
          access: deps.services.access,
        },
        request.body.mutations,
      );
      const result = { results: outcome.results, serverRev: outcome.serverRev };
      await deps.services.issueNotifier.afterPush(request.member, outcome.issueChanges);
      let superseded = 0;
      let rejected = 0;
      for (const item of result.results) {
        if (item.status === MUTATION_STATUS.superseded) {
          superseded += 1;
        }
        if (item.status === MUTATION_STATUS.rejected) {
          rejected += 1;
        }
      }
      request.log.info(
        {
          uid: request.uid,
          pushed: result.results.length,
          superseded,
          rejected,
          serverRev: result.serverRev,
          elapsedMs: Date.now() - started,
        },
        LOG.sync.push,
      );
      return result;
    },
  );
}
