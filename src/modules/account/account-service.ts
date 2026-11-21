import { ROLE } from '../../constants/domain/roles.js';
import { ErrorCode } from '../../constants/http/error-codes.js';
import type { Database } from '../../data/database.js';
import { conflict } from '../../core/errors.js';
import type { TokenVerifier } from '../../core/auth.js';
import type { UploadService } from '../uploads/upload-service.js';
import type { AccessService } from '../team/access-service.js';

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
    if (lookup.status === 'member' && lookup.member.role === ROLE.admin) {
      if ((await this.db.repos.members.countLiveWithRole(ROLE.admin)) <= 1) {
        throw conflict(
          ErrorCode.lastAdmin,
          'The last Admin cannot leave; make someone else Admin first',
        );
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
          type: 'account_deleted',
          subjectUid: uid,
        });
      }
      return count;
    });
    await this.tokens.deleteUser(uid);
    return { abortedUploads, deletedRows };
  }
}
