import type { Queryable } from '../../data/database.js';

export const MEMBER_EVENT_TYPES = [
  'invited',
  'invite_resent',
  'invite_cancelled',
  'joined',
  'role_changed',
  'projects_changed',
  'removed',
  'account_deleted',
] as const;
export type MemberEventType = (typeof MEMBER_EVENT_TYPES)[number];

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
  actor_uid: string | null;
  actor_name: string | null;
  subject_uid: string | null;
  subject_name: string | null;
  invitation_id: string | null;
  detail: Record<string, unknown>;
}

// Append-only audit (05 §9): who did what to whom, when. Never updated, never deleted.
export class MemberEventRepository {
  constructor(private readonly db: Queryable) {}

  async record(event: MemberEvent): Promise<void> {
    await this.db.query(
      `insert into member_events (actor_uid, type, subject_uid, invitation_id, detail)
       values ($1, $2, $3, $4, $5)`,
      [
        event.actorUid,
        event.type,
        event.subjectUid ?? null,
        event.invitationId ?? null,
        JSON.stringify(event.detail ?? {}),
      ],
    );
  }

  // Newest first; `before` is the id of the last event of the previous page.
  async page(before: string | null, limit: number): Promise<MemberEventRow[]> {
    const result = await this.db.query<MemberEventRow>(
      `select e.id::text as id, e.at, e.type, e.actor_uid, a.name as actor_name,
              e.subject_uid, s.name as subject_name, e.invitation_id, e.detail
         from member_events e
         left join members a on a.uid = e.actor_uid
         left join members s on s.uid = e.subject_uid
        where ($1::bigint is null or e.id < $1::bigint)
        order by e.id desc
        limit $2`,
      [before, limit],
    );
    return result.rows;
  }
}
