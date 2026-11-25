import { ROLES_REACHING_ALL } from '../../../constants/domain/roles.js';
import type { Database } from '../../../data/database.js';
import type { Member, MemberLookup, Reach } from '../members/member.js';
import type { Repositories } from '../../../data/repositories.js';
import { MEMBER_LOOKUP, REACH_ALL } from '../../../constants/domain/team.js';

// The one place that decides who is a member and which projects they reach. Every route, the
// sync pull and push, the upload signer, the WebSocket and push ask it (05 §4).
export class AccessService {
  constructor(private readonly db: Database) {}

  async lookup(uid: string): Promise<MemberLookup> {
    const row = await this.db.repos.members.find(uid);

    if (row === undefined) {
      return { status: MEMBER_LOOKUP.unknown };
    }
    if (row.removedAt !== null) {
      return { status: MEMBER_LOOKUP.removed };
    }

    return {
      status: MEMBER_LOOKUP.member,
      member: {
        uid: row.uid,
        email: row.email,
        name: row.name,
        role: row.role,
        resyncRequired: row.resyncRequired,
      },
    };
  }

  // Pass the repositories of an open transaction to read inside it.
  async reach(member: Member, repos: Repositories = this.db.repos): Promise<Reach> {
    if (ROLES_REACHING_ALL.includes(member.role)) {
      return REACH_ALL;
    }

    return repos.projectMembers.projectsOf(member.uid);
  }

  async membersReaching(projectId: string): Promise<string[]> {
    return this.db.repos.members.liveUidsReaching(projectId, ROLES_REACHING_ALL);
  }
}
