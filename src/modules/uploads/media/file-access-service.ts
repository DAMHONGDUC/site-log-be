import { ErrorCode } from '../../../constants/http/error-codes.js';
import { ACTION, type Action } from '../../../constants/domain/roles.js';
import { reaches, type Member, can, type AccessService } from '../../team/index.js';
import { badRequest, forbidden } from '../../../core/errors.js';
import { parseKey, type ParsedKey } from '../keys/object-keys.js';
import { FILE_ACCESS, type FileAccess } from '../../../constants/domain/team.js';
import { ERROR_TEXT } from '../../../constants/messages/error-text.js';

const WRITE_ACTION: Record<ParsedKey['kind'], Action> = {
  capture: ACTION.captureWrite,
  plan: ACTION.planEdit,
  branding: ACTION.brandingEdit,
};

// Who may read (media URLs) or write (begin upload) an object key (05 §7).
export class FileAccessService {
  constructor(private readonly access: AccessService) {}

  async check(member: Member, key: string, mode: FileAccess): Promise<ParsedKey> {
    const parsed = parseKey(key);
    if (parsed === undefined) {
      throw badRequest(ErrorCode.invalidKey, ERROR_TEXT.keyShape);
    }
    if (!reaches(await this.access.reach(member), parsed.projectId)) {
      throw forbidden();
    }
    if (mode === FILE_ACCESS.write && !can(member.role, WRITE_ACTION[parsed.kind])) {
      throw forbidden();
    }
    return parsed;
  }
}
