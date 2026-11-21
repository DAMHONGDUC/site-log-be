import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import { ApiRoutes } from '../constants/api-routes.js';
import { ErrorCode } from '../constants/error-codes.js';
import { LIMITS, PATTERNS } from '../constants/limits.js';
import { isRole } from '../domain/permissions.js';
import { badRequest } from '../errors.js';
import { memberMay, type Guards } from '../http/guards.js';
import { Schemas, rateLimit } from '../http/schemas.js';

// F19 invitation calls (01-api §13, 05 §5).
export function invitationRoutes(app: FastifyInstance, deps: AppDeps, guards: Guards): void {
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
    { preHandler: memberMay(guards, 'team.manage'), schema: { body: InviteBody } },
    async (request) => {
      const { role } = request.body;
      if (!isRole(role)) {
        throw badRequest(ErrorCode.invalidRole, 'Role must be admin, manager, inspector or viewer');
      }
      const result = await invitations.invite(request.member, { ...request.body, role });
      request.log.info(
        { uid: request.uid, invitationId: result.invitationId, role },
        'member invited',
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
      request.log.info({ uid: request.uid, invitationId, role: joined.role }, 'invite accepted');
      return joined;
    },
  );

  typed.post(
    ApiRoutes.INVITATION_RESEND,
    { preHandler: memberMay(guards, 'team.manage'), schema: { params: Schemas.idParams() } },
    async (request) => {
      const result = await invitations.resend(request.member, request.params.id);
      request.log.info({ uid: request.uid, invitationId: result.invitationId }, 'invite resent');
      return result;
    },
  );

  typed.delete(
    ApiRoutes.INVITATION,
    { preHandler: memberMay(guards, 'team.manage'), schema: { params: Schemas.idParams() } },
    async (request) => {
      await invitations.cancel(request.member, request.params.id);
      request.log.info({ uid: request.uid, invitationId: request.params.id }, 'invite cancelled');
      return { cancelled: true };
    },
  );
}
