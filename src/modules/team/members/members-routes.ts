import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyPluginAsync } from 'fastify';
import { ApiRoutes } from '../../../constants/http/api-routes.js';
import { LIMITS, PATTERNS } from '../../../constants/runtime/limits.js';
import { memberMay } from '../../../core/http/guards.js';
import { Schemas } from '../../../core/http/schemas.js';
import { ACTION } from '../../../constants/domain/roles.js';
import { LOG } from '../../../constants/messages/log.js';

// F19 member calls (01-api §13): who am I, the team, roles, projects, activity.
export const memberRoutes: FastifyPluginAsync = async (app) => {
  const { deps, guards } = app;
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  const { team, invitations } = deps.services;

  typed.get(ApiRoutes.ME, { preHandler: guards.requireUser }, async (request) =>
    team.me(request.member),
  );

  typed.get(ApiRoutes.MEMBERS, { preHandler: memberMay(guards, ACTION.membersRead) }, async () => ({
    members: await team.listMembers(),
    invitations: await invitations.listOpen(),
  }));

  const UidParams = Type.Object({ uid: Schemas.uid() });
  const PatchBody = Type.Object({
    role: Type.Optional(Schemas.role()),
    projectIds: Type.Optional(Type.Array(Schemas.uuid(), { maxItems: LIMITS.projectsPerInvite })),
  });
  typed.patch(
    ApiRoutes.MEMBER,
    {
      preHandler: memberMay(guards, ACTION.teamManage),
      schema: { params: UidParams, body: PatchBody },
    },
    async (request) => {
      const result = await team.changeMember(request.member, request.params.uid, request.body);
      request.log.info(
        { uid: request.uid, member: request.params.uid, role: result.role },
        LOG.team.memberChanged,
      );
      return result;
    },
  );

  typed.delete(
    ApiRoutes.MEMBER,
    { preHandler: memberMay(guards, ACTION.teamManage), schema: { params: UidParams } },
    async (request) => {
      await team.removeMember(request.member, request.params.uid);
      request.log.info({ uid: request.uid, member: request.params.uid }, LOG.team.memberRemoved);
      return { removed: true };
    },
  );

  const ProjectBody = Type.Object({
    uids: Type.Array(Schemas.uid(), { maxItems: LIMITS.membersPerProject }),
  });
  typed.put(
    ApiRoutes.PROJECT_MEMBERS,
    {
      preHandler: memberMay(guards, ACTION.projectMembers),
      schema: { params: Schemas.idParams(), body: ProjectBody },
    },
    async (request) => {
      const projectId = request.params.id.toLowerCase();
      const uids = await team.setProjectMembers(request.member, projectId, request.body.uids);
      request.log.info(
        { uid: request.uid, projectId, count: uids.length },
        LOG.team.projectMembersSet,
      );
      return { projectId, uids };
    },
  );

  const EventsQuery = Type.Object({
    before: Type.Optional(Type.String({ pattern: PATTERNS.eventCursor })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: LIMITS.memberEventsPageMax })),
  });
  typed.get(
    ApiRoutes.MEMBER_EVENTS,
    { preHandler: memberMay(guards, ACTION.teamManage), schema: { querystring: EventsQuery } },
    async (request) =>
      team.activity(
        request.query.before ?? null,
        request.query.limit ?? LIMITS.memberEventsPageDefault,
      ),
  );
};
