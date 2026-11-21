import type { Queryable } from './database.js';
import { DeviceRepository } from '../modules/devices/device-repository.js';
import { InvitationRepository } from '../modules/team/invitation-repository.js';
import { IssueRepository } from '../modules/sync/issue-repository.js';
import { MemberEventRepository } from '../modules/team/member-event-repository.js';
import { MemberRepository } from '../modules/team/member-repository.js';
import { PhraseRepository } from '../modules/sync/phrase-repository.js';
import { ProjectMemberRepository } from '../modules/team/project-member-repository.js';
import { ProjectRepository } from '../modules/sync/project-repository.js';
import { UploadRepository } from '../modules/uploads/upload-repository.js';

// Every repository, bound to one connection (the pool or a transaction).
export interface Repositories {
  members: MemberRepository;
  projectMembers: ProjectMemberRepository;
  projects: ProjectRepository;
  invitations: InvitationRepository;
  memberEvents: MemberEventRepository;
  devices: DeviceRepository;
  phrases: PhraseRepository;
  issues: IssueRepository;
  uploads: UploadRepository;
}

export function createRepositories(db: Queryable): Repositories {
  return {
    members: new MemberRepository(db),
    projectMembers: new ProjectMemberRepository(db),
    projects: new ProjectRepository(db),
    invitations: new InvitationRepository(db),
    memberEvents: new MemberEventRepository(db),
    devices: new DeviceRepository(db),
    phrases: new PhraseRepository(db),
    issues: new IssueRepository(db),
    uploads: new UploadRepository(db),
  };
}
