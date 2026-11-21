import type { Member } from '../team/members/member.js';
import type { NotificationService } from './notification-service.js';
import { PUSH_KIND } from '../../constants/domain/push.js';

// An issue row before and after one applied push (snake_case columns).
export interface IssueChange {
  issueId: string;
  projectId: string;
  before: Record<string, unknown> | undefined;
  after: Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// After a sync push commits: tell a new assignee (issueAssigned) and tell the creator and the
// assignee about a re-check (status or resolved-by changed: issueRechecked).
export class IssueNotifier {
  constructor(private readonly notifications: NotificationService) {}

  async afterPush(actor: Member, changes: IssueChange[]): Promise<void> {
    for (const change of changes) {
      const { before, after } = change;
      const assignee = text(after.assignee_uid);
      if (assignee !== '' && assignee !== text(before?.assignee_uid)) {
        await this.notifications.send({
          kind: PUSH_KIND.issueAssigned,
          recipients: [assignee],
          actorUid: actor.uid,
          data: {
            issueId: change.issueId,
            title: text(after.title),
            severity: text(after.severity),
            dueDate: after.due_date ? String(after.due_date) : null,
          },
        });
      }
      if (before !== undefined && this.wasRechecked(before, after)) {
        await this.notifications.send({
          kind: PUSH_KIND.issueRechecked,
          recipients: [text(after.created_by), assignee],
          actorUid: actor.uid,
          data: {
            issueId: change.issueId,
            title: text(after.title),
            status: text(after.status),
            actorName: actor.name,
          },
        });
      }
    }
  }

  private wasRechecked(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
    return (
      text(before.status) !== text(after.status) ||
      (before.resolved_by_issue_id ?? null) !== (after.resolved_by_issue_id ?? null)
    );
  }
}
