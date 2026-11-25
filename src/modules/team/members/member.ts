import type { Role } from '../../../constants/domain/roles.js';
import { MEMBER_LOOKUP, REACH_ALL } from '../../../constants/domain/team.js';

export interface Member {
  uid: string;
  email: string;
  name: string;
  role: Role;
  resyncRequired: boolean;
}

// 'all' for roles that reach every project; otherwise the projects the member was added to.
export type Reach = typeof REACH_ALL | string[];

export type MemberLookup =
  | { status: typeof MEMBER_LOOKUP.member; member: Member }
  | { status: typeof MEMBER_LOOKUP.removed }
  | { status: typeof MEMBER_LOOKUP.unknown };

// null = a row of no project (company-wide), reachable by every member.
export function reaches(reach: Reach, projectId: string | null): boolean {
  if (projectId === null || reach === REACH_ALL) {
    return true;
  }

  return reach.includes(projectId);
}
