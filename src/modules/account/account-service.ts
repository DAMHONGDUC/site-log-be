import { ROLE } from '../../constants/domain/roles.js';
import { ErrorCode } from '../../constants/http/error-codes.js';
import type { Database } from '../../data/database.js';
import { conflict } from '../../core/errors.js';
import type { TokenVerifier } from '../../core/auth.js';
import type { UploadService } from '../uploads/index.js';
import type { AccessService } from '../team/index.js';
import { MEMBER_LOOKUP } from '../../constants/domain/team.js';
import { ERROR_TEXT } from '../../constants/messages/error-text.js';
import { MEMBER_EVENT_TYPE } from '../../constants/data/enums.js';

// Leaving the company (05 §8): the caller's unfinished uploads, phrases, devices and Firebase
// user go; photos, issues and reports stay with the company. A repeat returns zeros.
export class AccountService {
  constructor(
    private readonly db: Database,
    private readonly access: AccessService,
    private readonly uploads: UploadService,
    private readonly tokens: TokenVerifier,
  ) {}

  async leave(uid: string): Promise<{ abortedUploads: number; deletedRows: number }> {
    const lookup = await this.access.lookup(uid);
    if (lookup.status === MEMBER_LOOKUP.member && lookup.member.role === ROLE.admin) {
      if ((await this.db.repos.members.countLiveWithRole(ROLE.admin)) <= 1) {
        throw conflict(ErrorCode.lastAdmin, ERROR_TEXT.lastAdminLeaving);
      }
    }
    const abortedUploads = await this.uploads.abortAllOpen(uid);
    const deletedRows = await this.db.transaction(async (repos) => {
      const count =
        (await repos.phrases.removeAllFor(uid)) +
        (await repos.devices.removeAllFor(uid)) +
        (await repos.projectMembers.removeAllFor(uid));
      if (await repos.members.markRemoved(uid)) {
        await repos.memberEvents.record({
          actorUid: uid,
          type: MEMBER_EVENT_TYPE.account_deleted,
          subjectUid: uid,
        });
      }
      return count;
    });
    await this.tokens.deleteUser(uid);
    return { abortedUploads, deletedRows };
  }
}
