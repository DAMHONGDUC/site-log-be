import { ErrorCode } from '../constants/error-codes.js';
import type { Role } from '../constants/roles.js';
import { ROLES_REACHING_ALL } from '../constants/roles.js';
import type { Database } from '../data/database.js';
import type { Member, Reach } from '../domain/member.js';
import { conflict, notFound } from '../errors.js';
import type { Repositories } from '../repositories/index.js';
import type { MemberEventRow } from '../repositories/member-event-repository.js';
import type { TokenVerifier } from '../auth.js';
import type { AccessService } from './access-service.js';
import type { NotificationService } from './notification-service.js';

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
  return ROLES_REACHING_ALL.includes(role) ? 'all' : projectIds;
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
      projectIds: reachOf(row.role, row.project_ids),
      lastSeenAt: row.last_seen_at,
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
      if (current.role === 'admin' && role !== 'admin') {
        await this.ensureAnotherAdmin(repos);
      }
      const roleChanged = role !== current.role;
      if (roleChanged) {
        await repos.members.setRole(uid, role);
        await repos.memberEvents.record({
          actorUid: actor.uid,
          type: 'role_changed',
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
            type: 'projects_changed',
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
        kind: 'access',
        recipients: [uid],
        actorUid: actor.uid,
        data: { change: 'role', role: result.role, actorName: actor.name },
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
      if (current.role === 'admin') {
        await this.ensureAnotherAdmin(repos);
      }
      await repos.members.markRemoved(uid);
      await repos.projectMembers.removeAllFor(uid);
      await repos.devices.removeAllFor(uid);
      await repos.memberEvents.record({ actorUid: actor.uid, type: 'removed', subjectUid: uid });
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
        throw notFound(ErrorCode.memberNotFound, 'One of the members does not exist');
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
          type: 'projects_changed',
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
        actor: row.actor_uid === null ? null : { uid: row.actor_uid, name: row.actor_name ?? '' },
        subject:
          row.subject_uid === null ? null : { uid: row.subject_uid, name: row.subject_name ?? '' },
        invitationId: row.invitation_id,
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
      throw notFound(ErrorCode.projectNotFound, 'One of the projects does not exist');
    }
  }

  private async liveMember(repos: Repositories, uid: string): Promise<{ role: Role }> {
    const current = await repos.members.findLiveForUpdate(uid);
    if (current === undefined) {
      throw notFound(ErrorCode.memberNotFound, 'No such member');
    }
    return current;
  }

  // There must always be one Admin (05 §2, §8).
  private async ensureAnotherAdmin(repos: Repositories): Promise<void> {
    if ((await repos.members.countLiveWithRole('admin')) <= 1) {
      throw conflict(ErrorCode.lastAdmin, 'There must always be one Admin');
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
        kind: 'access',
        recipients: [uid],
        actorUid: actor.uid,
        data: {
          change: 'added',
          projectId,
          projectName: names.get(projectId) ?? '',
          actorName: actor.name,
        },
      });
    }
    for (const projectId of diff.removed) {
      await this.notifications.send({
        kind: 'access',
        recipients: [uid],
        actorUid: actor.uid,
        data: { change: 'removed', projectName: names.get(projectId) ?? '', actorName: actor.name },
      });
    }
  }
}
