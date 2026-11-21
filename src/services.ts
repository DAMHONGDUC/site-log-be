import type { TokenVerifier } from './core/auth.js';
import type { Config } from './core/config.js';
import type { Database } from './data/database.js';
import type { Log } from './core/log.js';
import type { Mailer } from './integrations/mailer.js';
import type { PushSender } from './integrations/fcm.js';
import type { Storage } from './integrations/storage.js';
import { AccessService } from './modules/team/access/access-service.js';
import { AccountService } from './modules/account/account-service.js';
import { DueSoonService } from './modules/notifications/due-soon-service.js';
import { FileAccessService } from './modules/uploads/media/file-access-service.js';
import { InvitationService } from './modules/team/invitations/invitation-service.js';
import { IssueNotifier } from './modules/notifications/issue-notifier.js';
import { KeyMigrationService } from './modules/uploads/keys/key-migration-service.js';
import { NotificationService } from './modules/notifications/notification-service.js';
import { TeamService } from './modules/team/members/team-service.js';
import { UploadService } from './modules/uploads/transfer/upload-service.js';

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
