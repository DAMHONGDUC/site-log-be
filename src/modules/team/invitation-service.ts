import type { Config } from '../../core/config.js';
import { ErrorCode } from '../../constants/http/error-codes.js';
import { FALLBACK_NAME } from '../../constants/domain/push.js';
import { ROLES_REACHING_ALL, type Role } from '../../constants/domain/roles.js';
import type { Database } from '../../data/database.js';
import { hashToken, maskEmail, nameFromEmail, newInviteToken } from './invitation-token.js';
import type { Member, Reach } from './member.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import type { Mailer } from '../../integrations/mailer.js';
import { inviteLink, inviteMail } from './invitation-mail.js';
import type { Repositories } from '../../data/repositories.js';
import type { InvitationRow } from './invitation-repository.js';
import { PATTERNS } from '../../constants/runtime/limits.js';
import type { TeamService } from './team-service.js';

// Invitations (05 §5): create, preview before sign-in, accept, resend, cancel.
export class InvitationService {
  constructor(
    private readonly db: Database,
    private readonly team: TeamService,
    private readonly mailer: Mailer,
    private readonly config: Pick<Config, 'inviteBaseUrl' | 'inviteTtlDays'>,
  ) {}

  async invite(actor: Member, input: { email: string; role: Role; projectIds: string[] }) {
    const email = input.email.trim().toLowerCase();
    if (!PATTERNS.email.test(email)) {
      throw badRequest(ErrorCode.invalidEmail, 'This is not an email address');
    }
    const projectIds = [...new Set(input.projectIds.map((id) => id.toLowerCase()))];
    await this.team.ensureProjectsExist(this.db.repos, projectIds);
    if (await this.db.repos.members.liveEmailExists(email)) {
      throw conflict(ErrorCode.alreadyMember, 'This email already belongs to a member');
    }
    const token = newInviteToken();
    const created = await this.db.transaction(async (repos) => {
      await repos.invitations.cancelOpenFor(email);
      const row = await repos.invitations.create({
        email,
        role: input.role,
        projectIds,
        tokenHash: hashToken(token),
        invitedBy: actor.uid,
        ttlDays: this.config.inviteTtlDays,
      });
      await repos.memberEvents.record({
        actorUid: actor.uid,
        type: 'invited',
        invitationId: row.id,
        detail: { email, role: input.role, projectIds },
      });
      return row;
    });
    await this.sendMail(email, actor.name, input.role, token);
    return { invitationId: created.id, expiresAt: created.expiresAt };
  }

  async preview(token: string) {
    const row = await this.validToken(this.db.repos, token, false);
    const inviter = await this.db.repos.members.displayName(row.invitedBy);
    const names = await this.db.repos.projects.namesByIds(row.projectIds);
    return {
      invitedBy: inviter || FALLBACK_NAME.admin,
      role: row.role,
      projects: row.projectIds.map((id) => ({ id, name: names.get(id) ?? '' })),
      email: maskEmail(row.email),
      expiresAt: row.expiresAt,
    };
  }

  // The signed-in Firebase user joins; their email must be the invited one.
  async accept(uid: string, email: string | undefined, token: string) {
    const row = await this.db.transaction(async (repos) => {
      const invite = await this.validToken(repos, token, true);
      if ((email ?? '').toLowerCase() !== invite.email.toLowerCase()) {
        throw conflict(ErrorCode.emailMismatch, 'Sign in with the email the invite was sent to');
      }
      await repos.members.upsertFromInvitation(
        uid,
        invite.email,
        nameFromEmail(invite.email),
        invite.role,
      );
      await this.team.replaceProjects(repos, uid, invite.projectIds, invite.invitedBy);
      await repos.invitations.markAccepted(invite.id, uid);
      await repos.memberEvents.record({
        actorUid: uid,
        type: 'joined',
        subjectUid: uid,
        invitationId: invite.id,
        detail: { role: invite.role, projectIds: invite.projectIds },
      });
      return invite;
    });
    const projectIds: Reach = ROLES_REACHING_ALL.includes(row.role) ? 'all' : row.projectIds;
    return { uid, role: row.role, projectIds, invitationId: row.id };
  }

  // A new token and email; the old link stops working.
  async resend(actor: Member, id: string) {
    const token = newInviteToken();
    const result = await this.db.transaction(async (repos) => {
      const invite = await this.openInvitation(repos, id);
      const expiresAt = await repos.invitations.renew(
        invite.id,
        hashToken(token),
        this.config.inviteTtlDays,
      );
      await repos.memberEvents.record({
        actorUid: actor.uid,
        type: 'invite_resent',
        invitationId: invite.id,
      });
      return { invite, expiresAt };
    });
    await this.sendMail(result.invite.email, actor.name, result.invite.role, token);
    return { invitationId: result.invite.id, expiresAt: result.expiresAt };
  }

  async cancel(actor: Member, id: string): Promise<void> {
    await this.db.transaction(async (repos) => {
      const invite = await this.openInvitation(repos, id);
      await repos.invitations.cancel(invite.id);
      await repos.memberEvents.record({
        actorUid: actor.uid,
        type: 'invite_cancelled',
        invitationId: invite.id,
      });
    });
  }

  async listOpen() {
    const rows = await this.db.repos.invitations.listOpen();
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      projectIds: row.projectIds,
      expiresAt: row.expiresAt,
    }));
  }

  private async validToken(
    repos: Repositories,
    token: string,
    lock: boolean,
  ): Promise<InvitationRow> {
    const row = await repos.invitations.findByTokenHash(hashToken(token), lock);
    if (row === undefined) {
      throw notFound(ErrorCode.inviteNotFound, 'This invite does not exist');
    }
    if (row.acceptedAt !== null) {
      throw conflict(ErrorCode.inviteUsed, 'This invite was already used');
    }
    if (row.cancelledAt !== null || row.expiresAt.getTime() < Date.now()) {
      throw conflict(ErrorCode.inviteExpired, 'This invite has expired or was replaced');
    }
    return row;
  }

  private async openInvitation(repos: Repositories, id: string): Promise<InvitationRow> {
    const row = await repos.invitations.findForUpdate(id);
    if (row === undefined) {
      throw notFound(ErrorCode.inviteNotFound, 'No such invite');
    }
    if (row.acceptedAt !== null) {
      throw conflict(ErrorCode.inviteAccepted, 'This invite was already accepted');
    }
    return row;
  }

  private async sendMail(
    to: string,
    inviterName: string,
    role: Role,
    token: string,
  ): Promise<void> {
    await this.mailer.send(
      inviteMail({
        to,
        inviterName,
        role,
        link: inviteLink(this.config.inviteBaseUrl, token),
        ttlDays: this.config.inviteTtlDays,
      }),
    );
  }
}
