import { desc, eq, lt } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { MemberEventType } from '../../../constants/data/enums.js';
import type { SqlDb } from '../../../data/drizzle.js';
import { memberEvents, members } from '../../../data/schema/index.js';
import { TABLE_ALIAS } from '../../../constants/data/db.js';

export interface MemberEvent {
  actorUid: string | null;
  type: MemberEventType;
  subjectUid?: string | null;
  invitationId?: string | null;
  detail?: Record<string, unknown>;
}

export interface MemberEventRow {
  id: string;
  at: Date;
  type: MemberEventType;
  actorUid: string | null;
  actorName: string | null;
  subjectUid: string | null;
  subjectName: string | null;
  invitationId: string | null;
  detail: Record<string, unknown>;
}

const actor = alias(members, TABLE_ALIAS.actor);
const subject = alias(members, TABLE_ALIAS.subject);

// Append-only audit (05 §9): who did what to whom, when. Never updated, never deleted.
export class MemberEventRepository {
  constructor(private readonly db: SqlDb) {}

  async record(event: MemberEvent): Promise<void> {
    await this.db.insert(memberEvents).values({
      actorUid: event.actorUid,
      type: event.type,
      subjectUid: event.subjectUid ?? null,
      invitationId: event.invitationId ?? null,
      detail: event.detail ?? {},
    });
  }

  // Newest first; `before` is the id of the last event of the previous page.
  async page(before: string | null, limit: number): Promise<MemberEventRow[]> {
    const rows = await this.db
      .select({
        id: memberEvents.id,
        at: memberEvents.at,
        type: memberEvents.type,
        actorUid: memberEvents.actorUid,
        actorName: actor.name,
        subjectUid: memberEvents.subjectUid,
        subjectName: subject.name,
        invitationId: memberEvents.invitationId,
        detail: memberEvents.detail,
      })
      .from(memberEvents)
      .leftJoin(actor, eq(actor.uid, memberEvents.actorUid))
      .leftJoin(subject, eq(subject.uid, memberEvents.subjectUid))
      .where(before === null ? undefined : lt(memberEvents.id, Number(before)))
      .orderBy(desc(memberEvents.id))
      .limit(limit);
    // The cursor travels as text: ids are bigint.
    return rows.map((row) => ({ ...row, id: String(row.id) }));
  }
}
