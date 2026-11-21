import type { TokenVerifier } from '../auth.js';
import type { Config } from '../config.js';
import type { Database } from '../data/database.js';
import type { Log } from '../domain/log.js';
import type { Mailer } from '../mail/mailer.js';
import type { PushSender } from '../push/fcm.js';
import type { Storage } from '../storage.js';
import { AccessService } from './access-service.js';
import { AccountService } from './account-service.js';
import { DueSoonService } from './due-soon-service.js';
import { FileAccessService } from './file-access-service.js';
import { InvitationService } from './invitation-service.js';
import { IssueNotifier } from './issue-notifier.js';
import { KeyMigrationService } from './key-migration-service.js';
import { NotificationService } from './notification-service.js';
import { TeamService } from './team-service.js';
import { UploadService } from './upload-service.js';

export interface CoreDeps {
  db: Database;
  config: Config;
  storage: Storage;
  push: PushSender | undefined;
  log: Log;
}

// What the worker and the API both use.
export interface CoreServices {
  access: AccessService;
  notifications: NotificationService;
  issueNotifier: IssueNotifier;
  files: FileAccessService;
  uploads: UploadService;
  dueSoon: DueSoonService;
  keyMigration: KeyMigrationService;
}

export interface Services extends CoreServices {
  team: TeamService;
  invitations: InvitationService;
  account: AccountService;
}

// The composition root of the services: every dependency is passed in, nothing is global.
export function createCoreServices(deps: CoreDeps): CoreServices {
  const access = new AccessService(deps.db);
  const notifications = new NotificationService(deps.db, deps.push, deps.log);
  const files = new FileAccessService(access);
  return {
    access,
    notifications,
    issueNotifier: new IssueNotifier(notifications),
    files,
    uploads: new UploadService(deps.db, deps.storage, files, deps.config, deps.log),
    dueSoon: new DueSoonService(deps.db, notifications, deps.config.siteTimeZone, deps.log),
    keyMigration: new KeyMigrationService(deps.db, deps.storage, deps.log),
  };
}

export function createServices(
  deps: CoreDeps & { tokens: TokenVerifier; mailer: Mailer },
): Services {
  const core = createCoreServices(deps);
  const team = new TeamService(deps.db, core.access, core.notifications, deps.tokens);
  return {
    ...core,
    team,
    invitations: new InvitationService(deps.db, team, deps.mailer, deps.config),
    account: new AccountService(deps.db, core.access, core.uploads, deps.tokens),
  };
}
