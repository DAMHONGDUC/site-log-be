import type { Role } from '../constants/roles.js';
import type { Queryable } from '../data/database.js';

export interface InvitationRow {
  id: string;
  email: string;
  role: Role;
  project_ids: string[];
  invited_by: string;
  expires_at: Date;
  accepted_at: Date | null;
  cancelled_at: Date | null;
}

const COLUMNS = 'id, email, role, project_ids, invited_by, expires_at, accepted_at, cancelled_at';

export class InvitationRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: {
    email: string;
    role: Role;
    projectIds: string[];
    tokenHash: Buffer;
    invitedBy: string;
    ttlDays: number;
  }): Promise<{ id: string; expires_at: Date }> {
    const result = await this.db.query<{ id: string; expires_at: Date }>(
      `insert into invitations (email, role, project_ids, token_hash, invited_by, expires_at)
       values ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
       returning id, expires_at`,
      [input.email, input.role, input.projectIds, input.tokenHash, input.invitedBy, input.ttlDays],
    );
    return result.rows[0]!;
  }

  // A newer invite for the same email replaces an open one.
  async cancelOpenFor(email: string): Promise<void> {
    await this.db.query(
      `update invitations set cancelled_at = now()
        where lower(email) = lower($1) and accepted_at is null and cancelled_at is null`,
      [email],
    );
  }

  async findByTokenHash(tokenHash: Buffer, lock = false): Promise<InvitationRow | undefined> {
    const result = await this.db.query<InvitationRow>(
      `select ${COLUMNS} from invitations where token_hash = $1 ${lock ? 'for update' : ''}`,
      [tokenHash],
    );
    return result.rows[0];
  }

  async findForUpdate(id: string): Promise<InvitationRow | undefined> {
    const result = await this.db.query<InvitationRow>(
      `select ${COLUMNS} from invitations where id = $1 for update`,
      [id],
    );
    return result.rows[0];
  }

  async listOpen(): Promise<InvitationRow[]> {
    const result = await this.db.query<InvitationRow>(
      `select ${COLUMNS} from invitations
        where accepted_at is null and cancelled_at is null and expires_at > now()
        order by created_at`,
    );
    return result.rows;
  }

  async markAccepted(id: string, uid: string): Promise<void> {
    await this.db.query(
      'update invitations set accepted_at = now(), accepted_by = $2 where id = $1',
      [id, uid],
    );
  }

  async renew(id: string, tokenHash: Buffer, ttlDays: number): Promise<Date> {
    const result = await this.db.query<{ expires_at: Date }>(
      `update invitations
          set token_hash = $2, expires_at = now() + make_interval(days => $3), cancelled_at = null
        where id = $1 returning expires_at`,
      [id, tokenHash, ttlDays],
    );
    return result.rows[0]!.expires_at;
  }

  async cancel(id: string): Promise<void> {
    await this.db.query('update invitations set cancelled_at = now() where id = $1', [id]);
  }
}
