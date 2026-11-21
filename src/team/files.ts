import type pg from 'pg';
import { AppError, badRequest } from '../errors.js';
import { parseKey, type ParsedKey } from '../keys.js';
import { reachable, reaches, type Member } from './access.js';
import { can, type Action } from './permissions.js';

function writeAction(parsed: ParsedKey): Action {
  if (parsed.kind === 'capture') {
    return 'capture.write';
  }
  if (parsed.kind === 'plan') {
    return 'plan.edit';
  }
  return 'branding.edit';
}

// A key the member may read (media URLs) or write (begin upload); otherwise 400 or 403.
export async function checkKey(
  pool: pg.Pool,
  member: Member,
  key: string,
  mode: 'read' | 'write',
): Promise<ParsedKey> {
  const parsed = parseKey(key);
  if (parsed === undefined) {
    throw badRequest('invalid_key', 'Key has the wrong shape');
  }
  const reach = await reachable(pool, member);
  if (!reaches(reach, parsed.projectId)) {
    throw new AppError(403, 'forbidden', 'Not allowed for your role');
  }
  if (mode === 'write' && !can(member.role, writeAction(parsed))) {
    throw new AppError(403, 'forbidden', 'Not allowed for your role');
  }
  return parsed;
}
