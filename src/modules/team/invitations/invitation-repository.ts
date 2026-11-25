import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Role } from '../../../constants/domain/roles.js';
import type { SqlDb } from '../../../data/drizzle.js';
import { invitations } from '../../../data/schema/index.js';
import { daysFromNow } from '../../../data/sql-time.js';

// Every column but the token hash, which never leaves the repository.
const COLUMNS = {
  id: invitations.id,
  email: invitations.email,
  role: invitations.role,
  projectIds: invitations.projectIds,
  invitedBy: invitations.invitedBy,
  expiresAt: invitations.expiresAt,
  acceptedAt: invitations.acceptedAt,
  cancelledAt: invitations.cancelledAt,
};

export interface InvitationRow {
  id: string;
  email: string;
  role: Role;
  projectIds: string[];
  invitedBy: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  cancelledAt: Date | null;
}

const isOpen = and(isNull(invitations.acceptedAt), isNull(invitations.cancelledAt));

export class InvitationRepository {
  constructor(private readonly db: SqlDb) {}

  async create(input: {
    email: string;
    role: Role;
    projectIds: string[];
    tokenHash: Buffer;
    invitedBy: string;
    ttlDays: number;
  }): Promise<{ id: string; expiresAt: Date }> {
    const [row] = await this.db
      .insert(invitations)
      .values({
        email: input.email,
        role: input.role,
        projectIds: input.projectIds,
        tokenHash: input.tokenHash,
        invitedBy: input.invitedBy,
        expiresAt: daysFromNow(input.ttlDays),
      })
      .returning({ id: invitations.id, expiresAt: invitations.expiresAt });

    return row!;
  }

  // A newer invite for the same email replaces an open one.
  async cancelOpenFor(email: string): Promise<void> {
    await this.db
      .update(invitations)
      .set({ cancelledAt: sql`now()` })
      .where(and(eq(sql`lower(${invitations.email})`, sql`lower(${email})`), isOpen));
  }

  async findByTokenHash(tokenHash: Buffer, lock = false): Promise<InvitationRow | undefined> {
    const query = this.db
      .select(COLUMNS)
      .from(invitations)
      .where(eq(invitations.tokenHash, tokenHash));
    const [row] = lock ? await query.for('update') : await query;

    return row;
  }

  async findForUpdate(id: string): Promise<InvitationRow | undefined> {
    const [row] = await this.db
      .select(COLUMNS)
      .from(invitations)
      .where(eq(invitations.id, id))
      .for('update');

    return row;
  }

  async listOpen(): Promise<InvitationRow[]> {
    return this.db
      .select(COLUMNS)
      .from(invitations)
      .where(and(isOpen, gt(invitations.expiresAt, sql`now()`)))
      .orderBy(asc(invitations.createdAt));
  }

  async markAccepted(id: string, uid: string): Promise<void> {
    await this.db
      .update(invitations)
      .set({ acceptedAt: sql`now()`, acceptedBy: uid })
      .where(eq(invitations.id, id));
  }

  async renew(id: string, tokenHash: Buffer, ttlDays: number): Promise<Date> {
    const [row] = await this.db
      .update(invitations)
      .set({ tokenHash, expiresAt: daysFromNow(ttlDays), cancelledAt: null })
      .where(eq(invitations.id, id))
      .returning({ expiresAt: invitations.expiresAt });

    return row!.expiresAt;
  }

  async cancel(id: string): Promise<void> {
    await this.db
      .update(invitations)
      .set({ cancelledAt: sql`now()` })
      .where(eq(invitations.id, id));
  }
}
