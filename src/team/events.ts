import type pg from 'pg';

export type MemberEventType =
  | 'invited'
  | 'invite_resent'
  | 'invite_cancelled'
  | 'joined'
  | 'role_changed'
  | 'projects_changed'
  | 'removed'
  | 'account_deleted';

export interface MemberEvent {
  actorUid: string | null;
  type: MemberEventType;
  subjectUid?: string | null;
  invitationId?: string | null;
  detail?: Record<string, unknown>;
}

// Append-only audit (05 §9): who did what to whom, when.
export async function recordMemberEvent(
  client: pg.Pool | pg.PoolClient,
  event: MemberEvent,
): Promise<void> {
  await client.query(
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
