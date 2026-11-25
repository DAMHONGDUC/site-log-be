import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyPluginAsync } from 'fastify';
import { ApiRoutes } from '../../../constants/http/api-routes.js';
import { ErrorCode } from '../../../constants/http/error-codes.js';
import { LIMITS, PATTERNS } from '../../../constants/runtime/limits.js';
import { isRole } from '../access/permissions.js';
import { badRequest } from '../../../core/errors.js';
import { memberMay } from '../../../core/http/guards.js';
import { Schemas, rateLimit } from '../../../core/http/schemas.js';
import { ACTION } from '../../../constants/domain/roles.js';
import { LOG } from '../../../constants/messages/log.js';
import { ERROR_TEXT } from '../../../constants/messages/error-text.js';

// F19 invitation calls (01-api §13, 05 §5).
export const invitationRoutes: FastifyPluginAsync = async (app) => {
  const { deps, guards } = app;
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  const { invitations } = deps.services;

  const InviteBody = Type.Object({
    email: Type.String({ minLength: LIMITS.emailMinLength, maxLength: LIMITS.emailMaxLength }),
    // Checked by hand so a wrong value answers invalid_role, not invalid_body.
    role: Type.String(),
    projectIds: Type.Array(Schemas.uuid(), { maxItems: LIMITS.projectsPerInvite }),
  });

  typed.post(
    ApiRoutes.INVITATIONS,
    { preHandler: memberMay(guards, ACTION.teamManage), schema: { body: InviteBody } },
    async (request) => {
      const { role } = request.body;

      if (!isRole(role)) {
        throw badRequest(ErrorCode.invalidRole, ERROR_TEXT.invalidRole);
      }
      const result = await invitations.invite(request.member, { ...request.body, role });

      request.log.info(
        { uid: request.uid, invitationId: result.invitationId, role },
        LOG.team.invited,
      );

      return result;
    },
  );

  // No Authorization: the link itself is the key. Rate limited per address.
  const TokenParams = Type.Object({ token: Type.String({ pattern: PATTERNS.inviteToken }) });

  typed.get(
    ApiRoutes.INVITATION_PREVIEW,
    {
      schema: { params: TokenParams },
      config: { rateLimit: rateLimit(deps.config.invitePreviewRateLimitPerMinute) },
    },
    async (request) => invitations.preview(request.params.token),
  );

  const AcceptBody = Type.Object({ token: Type.String({ pattern: PATTERNS.inviteToken }) });

  typed.post(
    ApiRoutes.INVITATION_ACCEPT,
    { preHandler: guards.requireSignedIn, schema: { body: AcceptBody } },
    async (request) => {
      const { invitationId, ...joined } = await invitations.accept(
        request.uid,
        request.email,
        request.body.token,
      );

      request.log.info(
        { uid: request.uid, invitationId, role: joined.role },
        LOG.team.inviteAccepted,
      );

      return joined;
    },
  );

  typed.post(
    ApiRoutes.INVITATION_RESEND,
    { preHandler: memberMay(guards, ACTION.teamManage), schema: { params: Schemas.idParams() } },
    async (request) => {
      const result = await invitations.resend(request.member, request.params.id);

      request.log.info(
        { uid: request.uid, invitationId: result.invitationId },
        LOG.team.inviteResent,
      );

      return result;
    },
  );

  typed.delete(
    ApiRoutes.INVITATION,
    { preHandler: memberMay(guards, ACTION.teamManage), schema: { params: Schemas.idParams() } },
    async (request) => {
      await invitations.cancel(request.member, request.params.id);
      request.log.info(
        { uid: request.uid, invitationId: request.params.id },
        LOG.team.inviteCancelled,
      );

      return { cancelled: true };
    },
  );
};
