import type { Queryable } from './database.js';
import { toDrizzle } from './drizzle.js';
import { DeviceRepository } from '../modules/devices/index.js';
import {
  InvitationRepository,
  MemberEventRepository,
  MemberRepository,
  ProjectMemberRepository,
} from '../modules/team/index.js';
import {
  IssueRepository,
  PhraseRepository,
  ProjectRepository,
  SyncStateRepository,
} from '../modules/sync/index.js';
import { UploadRepository } from '../modules/uploads/index.js';

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
  syncState: SyncStateRepository;
}

export function createRepositories(client: Queryable): Repositories {
  const db = toDrizzle(client);
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
    syncState: new SyncStateRepository(db),
  };
}
