import { ErrorCode } from '../../../constants/http/error-codes.js';
import { ROLE, ROLES_REACHING_ALL, type Role } from '../../../constants/domain/roles.js';
import type { Database } from '../../../data/database.js';
import type { Member, Reach } from './member.js';
import { conflict, notFound } from '../../../core/errors.js';
import type { Repositories } from '../../../data/repositories.js';
import type { MemberEventRow } from './member-event-repository.js';
import type { TokenVerifier } from '../../../core/auth.js';
import type { AccessService } from '../access/access-service.js';
import type { NotificationService } from '../../notifications/index.js';
import { REACH_ALL, ACCESS_CHANGE } from '../../../constants/domain/team.js';
import { MEMBER_EVENT_TYPE } from '../../../constants/data/enums.js';
import { PUSH_KIND } from '../../../constants/domain/push.js';
import { ERROR_TEXT } from '../../../constants/messages/error-text.js';

export interface MemberView {
  uid: string;
  email: string;
  name: string;
  role: Role;
  projectIds: Reach;
  lastSeenAt: Date | null;
}

export interface ProjectDiff {
  added: string[];
  removed: string[];
}

function reachOf(role: Role, projectIds: string[]): Reach {
  return ROLES_REACHING_ALL.includes(role) ? REACH_ALL : projectIds;
}

// Members, roles and project access (05-team-and-roles §2–4, §8). Permission checks are the
// route's job; this service keeps the rules: last Admin, resync, audit, `access` pushes.
export class TeamService {
  constructor(
    private readonly db: Database,
    private readonly access: AccessService,
    private readonly notifications: NotificationService,
    private readonly tokens: TokenVerifier,
  ) {}

  async me(member: Member) {
    await this.db.repos.members.touchLastSeen(member.uid);

    return {
      uid: member.uid,
      email: member.email,
      name: member.name,
      role: member.role,
      projectIds: await this.access.reach(member),
    };
  }

  async listMembers(): Promise<MemberView[]> {
    const rows = await this.db.repos.members.listLive();

    return rows.map((row) => ({
      uid: row.uid,
      email: row.email,
      name: row.name,
      role: row.role,
      projectIds: reachOf(row.role, row.projectIds),
      lastSeenAt: row.lastSeenAt,
    }));
  }

  async changeMember(
    actor: Member,
    uid: string,
    change: { role?: Role | undefined; projectIds?: string[] | undefined },
  ) {
    const result = await this.db.transaction(async (repos) => {
      const current = await this.liveMember(repos, uid);
      const role = change.role ?? current.role;

      if (current.role === ROLE.admin && role !== ROLE.admin) {
        await this.ensureAnotherAdmin(repos);
      }
      const roleChanged = role !== current.role;

      if (roleChanged) {
        await repos.members.setRole(uid, role);
        await repos.memberEvents.record({
          actorUid: actor.uid,
          type: MEMBER_EVENT_TYPE.role_changed,
          subjectUid: uid,
          detail: { from: current.role, to: role },
        });
      }
      let diff: ProjectDiff = { added: [], removed: [] };

      if (change.projectIds !== undefined && !ROLES_REACHING_ALL.includes(role)) {
        await this.ensureProjectsExist(repos, change.projectIds);
        diff = await this.replaceProjects(repos, uid, change.projectIds, actor.uid);
        if (diff.added.length + diff.removed.length > 0) {
          await repos.memberEvents.record({
            actorUid: actor.uid,
            type: MEMBER_EVENT_TYPE.projects_changed,
            subjectUid: uid,
            detail: { ...diff },
          });
        }
      }
      if (roleChanged || diff.added.length + diff.removed.length > 0) {
        await repos.members.requireResync(uid);
      }

      return { role, roleChanged, diff };
    });

    if (result.roleChanged) {
      await this.notifications.send({
        kind: PUSH_KIND.access,
        recipients: [uid],
        actorUid: actor.uid,
        data: { change: ACCESS_CHANGE.role, role: result.role, actorName: actor.name },
      });
    }
    await this.notifyProjects(actor, uid, result.diff);

    return {
      uid,
      role: result.role,
      projectIds: reachOf(result.role, await this.db.repos.projectMembers.projectsOf(uid)),
    };
  }

  async removeMember(actor: Member, uid: string): Promise<void> {
    await this.db.transaction(async (repos) => {
      const current = await this.liveMember(repos, uid);

      if (current.role === ROLE.admin) {
        await this.ensureAnotherAdmin(repos);
      }
      await repos.members.markRemoved(uid);
      await repos.projectMembers.removeAllFor(uid);
      await repos.devices.removeAllFor(uid);
      await repos.memberEvents.record({
        actorUid: actor.uid,
        type: MEMBER_EVENT_TYPE.removed,
        subjectUid: uid,
      });
    });
    await this.tokens.revoke(uid);
  }

  // PUT /projects/:id/members: the whole list of members added to one project.
  async setProjectMembers(actor: Member, projectId: string, uids: string[]): Promise<string[]> {
    const wanted = [...new Set(uids)];
    const diff = await this.db.transaction(async (repos) => {
      await this.ensureProjectsExist(repos, [projectId]);
      const known = await repos.members.liveUidsAmong(wanted);

      if (known.length !== wanted.length) {
        throw notFound(ErrorCode.memberNotFound, ERROR_TEXT.memberMissing);
      }
      const current = await repos.projectMembers.membersOf(projectId);
      const added = wanted.filter((uid) => !current.includes(uid));
      const removed = current.filter((uid) => !wanted.includes(uid));

      for (const uid of removed) {
        await repos.projectMembers.remove(projectId, uid);
      }
      for (const uid of added) {
        await repos.projectMembers.add(projectId, uid, actor.uid);
      }
      for (const uid of [...added, ...removed]) {
        await repos.members.requireResync(uid);
        await repos.memberEvents.record({
          actorUid: actor.uid,
          type: MEMBER_EVENT_TYPE.projects_changed,
          subjectUid: uid,
          detail: added.includes(uid) ? { added: [projectId] } : { removed: [projectId] },
        });
      }

      return { added, removed };
    });

    for (const uid of diff.added) {
      await this.notifyProjects(actor, uid, { added: [projectId], removed: [] });
    }
    for (const uid of diff.removed) {
      await this.notifyProjects(actor, uid, { added: [], removed: [projectId] });
    }

    return wanted;
  }

  async activity(before: string | null, limit: number) {
    const rows = await this.db.repos.memberEvents.page(before, limit + 1);
    const page = rows.slice(0, limit);

    return {
      events: page.map((row: MemberEventRow) => ({
        id: row.id,
        at: row.at,
        type: row.type,
        actor: row.actorUid === null ? null : { uid: row.actorUid, name: row.actorName ?? '' },
        subject:
          row.subjectUid === null ? null : { uid: row.subjectUid, name: row.subjectName ?? '' },
        invitationId: row.invitationId,
        detail: row.detail,
      })),
      next: rows.length > limit ? page[page.length - 1]!.id : null,
    };
  }

  // Shared with the invitation service: a new member's projects.
  async replaceProjects(
    repos: Repositories,
    uid: string,
    projectIds: string[],
    actorUid: string,
  ): Promise<ProjectDiff> {
    const before = await repos.projectMembers.projectsOf(uid);
    const wanted = [...new Set(projectIds.map((id) => id.toLowerCase()))];
    const added = wanted.filter((id) => !before.includes(id));
    const removed = before.filter((id) => !wanted.includes(id));

    for (const projectId of removed) {
      await repos.projectMembers.remove(projectId, uid);
    }
    for (const projectId of added) {
      await repos.projectMembers.add(projectId, uid, actorUid);
    }

    return { added, removed };
  }

  async ensureProjectsExist(repos: Repositories, ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const found = await repos.projects.liveIdsAmong(ids);

    if (found.length !== new Set(ids).size) {
      throw notFound(ErrorCode.projectNotFound, ERROR_TEXT.projectMissing);
    }
  }

  private async liveMember(repos: Repositories, uid: string): Promise<{ role: Role }> {
    const current = await repos.members.findLiveForUpdate(uid);

    if (current === undefined) {
      throw notFound(ErrorCode.memberNotFound, ERROR_TEXT.memberNotFound);
    }

    return current;
  }

  // There must always be one Admin (05 §2, §8).
  private async ensureAnotherAdmin(repos: Repositories): Promise<void> {
    if ((await repos.members.countLiveWithRole(ROLE.admin)) <= 1) {
      throw conflict(ErrorCode.lastAdmin, ERROR_TEXT.lastAdmin);
    }
  }

  private async notifyProjects(actor: Member, uid: string, diff: ProjectDiff): Promise<void> {
    const ids = [...diff.added, ...diff.removed];

    if (ids.length === 0) {
      return;
    }
    const names = await this.db.repos.projects.namesByIds(ids);

    for (const projectId of diff.added) {
      await this.notifications.send({
        kind: PUSH_KIND.access,
        recipients: [uid],
        actorUid: actor.uid,
        data: {
          change: ACCESS_CHANGE.added,
          projectId,
          projectName: names.get(projectId) ?? '',
          actorName: actor.name,
        },
      });
    }
    for (const projectId of diff.removed) {
      await this.notifications.send({
        kind: PUSH_KIND.access,
        recipients: [uid],
        actorUid: actor.uid,
        data: {
          change: ACCESS_CHANGE.removed,
          projectName: names.get(projectId) ?? '',
          actorName: actor.name,
        },
      });
    }
  }
}
