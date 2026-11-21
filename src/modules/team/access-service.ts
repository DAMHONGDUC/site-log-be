import { ROLES_REACHING_ALL } from '../../constants/roles.js';
import type { Database } from '../../data/database.js';
import type { Member, MemberLookup, Reach } from './member.js';
import type { Repositories } from '../../data/repositories.js';

// The one place that decides who is a member and which projects they reach. Every route, the
// sync pull and push, the upload signer, the WebSocket and push ask it (05 §4).
export class AccessService {
  constructor(private readonly db: Database) {}

  async lookup(uid: string): Promise<MemberLookup> {
    const row = await this.db.repos.members.find(uid);
    if (row === undefined) {
      return { status: 'unknown' };
    }
    if (row.removed_at !== null) {
      return { status: 'removed' };
    }
    return {
      status: 'member',
      member: {
        uid: row.uid,
        email: row.email,
        name: row.name,
        role: row.role,
        resyncRequired: row.resync_required,
      },
    };
  }

  // Pass the repositories of an open transaction to read inside it.
  async reach(member: Member, repos: Repositories = this.db.repos): Promise<Reach> {
    if (ROLES_REACHING_ALL.includes(member.role)) {
      return 'all';
    }
    return repos.projectMembers.projectsOf(member.uid);
  }

  async membersReaching(projectId: string): Promise<string[]> {
    return this.db.repos.members.liveUidsReaching(projectId, ROLES_REACHING_ALL);
  }
}
