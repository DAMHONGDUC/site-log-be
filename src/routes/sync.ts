import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { AppDeps } from '../app.js';
import { notifyIssueChanges } from '../push/issues.js';
import { pullChanges } from '../sync/pull.js';
import { pushMutations } from '../sync/push.js';

export function syncRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  requireUser: preHandlerAsyncHookHandler,
): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  const PullBody = Type.Object({
    since: Type.Integer({ minimum: 0 }),
    limit: Type.Integer({ minimum: 1, maximum: deps.config.pullPageSizeMax }),
  });

  typed.post(
    '/sync/pull',
    { preHandler: requireUser, schema: { body: PullBody } },
    async (request) => {
      const started = Date.now();
      const result = await pullChanges(
        deps.pool,
        request.member,
        request.body.since,
        request.body.limit,
      );
      if (result.resyncRequired) {
        request.log.info(
          { uid: request.uid, since: request.body.since },
          'sync pull: resync required',
        );
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
        'sync pull',
      );
      return { changes: result.changes, nextRev: result.nextRev, hasMore: result.hasMore };
    },
  );

  const Mutation = Type.Object({
    table: Type.String({ minLength: 1, maxLength: 64 }),
    id: Type.String({ format: 'uuid' }),
    op: Type.Union([Type.Literal('upsert'), Type.Literal('delete')]),
    clientUpdatedAt: Type.String({ format: 'date-time' }),
    fields: Type.Record(Type.String(), Type.Unknown()),
  });
  const PushBody = Type.Object({
    mutations: Type.Array(Mutation, { minItems: 1, maxItems: deps.config.pushBatchMax }),
  });

  typed.post(
    '/sync/push',
    { preHandler: requireUser, schema: { body: PushBody } },
    async (request) => {
      const started = Date.now();
      const outcome = await pushMutations(
        deps.pool,
        { member: request.member, siteTimeZone: deps.config.siteTimeZone },
        request.body.mutations,
      );
      const result = { results: outcome.results, serverRev: outcome.serverRev };
      await notifyIssueChanges(
        deps.pool,
        deps.push,
        request.log,
        request.member,
        outcome.issueChanges,
      );
      let superseded = 0;
      let rejected = 0;
      for (const item of result.results) {
        if (item.status === 'superseded') {
          superseded += 1;
        }
        if (item.status === 'rejected') {
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
        'sync push',
      );
      return result;
    },
  );
}
