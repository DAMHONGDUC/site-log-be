import type { TokenVerifier } from './core/auth.js';
import type { Config } from './core/config.js';
import type { Database } from './data/database.js';
import type { Log } from './core/log.js';
import type { Mailer } from './integrations/mailer.js';
import type { PushSender } from './integrations/fcm.js';
import type { Storage } from './integrations/storage.js';
import { AccessService, InvitationService, TeamService } from './modules/team/index.js';
import { AccountService } from './modules/account/index.js';
import {
  DueSoonService,
  IssueNotifier,
  NotificationService,
} from './modules/notifications/index.js';
import { FileAccessService, KeyMigrationService, UploadService } from './modules/uploads/index.js';

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
