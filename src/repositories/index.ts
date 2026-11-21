import type { Queryable } from '../data/database.js';
import { DeviceRepository } from './device-repository.js';
import { InvitationRepository } from './invitation-repository.js';
import { IssueRepository } from './issue-repository.js';
import { MemberEventRepository } from './member-event-repository.js';
import { MemberRepository } from './member-repository.js';
import { PhraseRepository } from './phrase-repository.js';
import { ProjectMemberRepository } from './project-member-repository.js';
import { ProjectRepository } from './project-repository.js';
import { UploadRepository } from './upload-repository.js';

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
