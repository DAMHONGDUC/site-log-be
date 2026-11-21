import type pg from 'pg';
import type { IssueChange } from '../sync/push.js';
import type { Member } from '../team/access.js';
import type { PushSender } from './fcm.js';
import { notify } from './notify.js';

type Log = Parameters<typeof notify>[2];

const SEVERITY: Record<string, string> = { critical: 'Critical', major: 'Major', minor: 'Minor' };
const STATUS: Record<string, string> = {
  open: 'still open',
  inProgress: 'in progress',
  resolved: 'resolved',
  verified: 'verified',
};

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// After a push commits: tell a new assignee, and tell the creator and assignee about a re-check.
export async function notifyIssueChanges(
  pool: pg.Pool,
  push: PushSender | undefined,
  log: Log,
  actor: Member,
  changes: IssueChange[],
): Promise<void> {
  if (push === undefined) {
    return;
  }
  for (const change of changes) {
    const after = change.after;
    const before = change.before;
    const deepLink = `sitelog://issue/${change.issueId}`;
    const assignee = text(after.assignee_uid);
    if (assignee !== '' && assignee !== text(before?.assignee_uid)) {
      const due = after.due_date ? ` Due ${String(after.due_date).slice(0, 10)}.` : '';
      await notify(pool, push, log, {
        kind: 'issueAssigned',
        recipients: [assignee],
        actorUid: actor.uid,
        title: `Assigned to you · ${SEVERITY[text(after.severity)] ?? 'Issue'}`,
        body: `${text(after.title)}.${due}`,
        deepLink,
      });
    }
    const rechecked =
      before !== undefined &&
      (text(before.status) !== text(after.status) ||
        (before.resolved_by_issue_id ?? null) !== (after.resolved_by_issue_id ?? null));
    if (rechecked) {
      await notify(pool, push, log, {
        kind: 'issueRechecked',
        recipients: [text(after.created_by), assignee].filter((uid) => uid !== ''),
        actorUid: actor.uid,
        title: `Re-check: ${STATUS[text(after.status)] ?? text(after.status)}`,
        body: `${actor.name || 'A team member'} re-checked ${text(after.title)}.`,
        deepLink,
      });
    }
  }
}
