import type { Role } from '../../constants/domain/roles.js';

export interface Member {
  uid: string;
  email: string;
  name: string;
  role: Role;
  resyncRequired: boolean;
}

// 'all' for roles that reach every project; otherwise the projects the member was added to.
export type Reach = 'all' | string[];

export type MemberLookup =
  { status: 'member'; member: Member } | { status: 'removed' } | { status: 'unknown' };

// null = a row of no project (company-wide), reachable by every member.
export function reaches(reach: Reach, projectId: string | null): boolean {
  if (projectId === null || reach === 'all') {
    return true;
  }
  return reach.includes(projectId);
}
