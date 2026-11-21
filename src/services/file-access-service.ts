import { ErrorCode } from '../constants/error-codes.js';
import type { Action } from '../constants/roles.js';
import type { Member } from '../domain/member.js';
import { reaches } from '../domain/member.js';
import { can } from '../domain/permissions.js';
import { badRequest, forbidden } from '../errors.js';
import { parseKey, type ParsedKey } from '../keys.js';
import type { AccessService } from './access-service.js';

const WRITE_ACTION: Record<ParsedKey['kind'], Action> = {
  capture: 'capture.write',
  plan: 'plan.edit',
  branding: 'branding.edit',
};

// Who may read (media URLs) or write (begin upload) an object key (05 §7).
export class FileAccessService {
  constructor(private readonly access: AccessService) {}

  async check(member: Member, key: string, mode: 'read' | 'write'): Promise<ParsedKey> {
    const parsed = parseKey(key);
    if (parsed === undefined) {
      throw badRequest(ErrorCode.invalidKey, 'Key has the wrong shape');
    }
    if (!reaches(await this.access.reach(member), parsed.projectId)) {
      throw forbidden();
    }
    if (mode === 'write' && !can(member.role, WRITE_ACTION[parsed.kind])) {
      throw forbidden();
    }
    return parsed;
  }
}
