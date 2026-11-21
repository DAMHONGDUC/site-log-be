import { DURATIONS } from '../../constants/durations.js';
import type { Database } from '../../data/database.js';
import type { Log } from '../../core/log.js';
import type { NotificationService } from './notification-service.js';

// Every day at DURATIONS.dueSoonHour site time: one push per assignee and project with the open
// issues due the next day.
export class DueSoonService {
  constructor(
    private readonly db: Database,
    private readonly notifications: NotificationService,
    private readonly siteTimeZone: string,
    private readonly log: Log,
  ) {}

  async run(): Promise<number> {
    const groups = await this.db.repos.issues.dueTomorrowByAssignee(this.siteTimeZone);
    let sent = 0;
    for (const group of groups) {
      sent += await this.notifications.send({
        kind: 'dueSoon',
        recipients: [group.assigneeUid],
        actorUid: null,
        data: {
          projectId: group.projectId,
          projectName: group.projectName,
          count: group.count,
          titles: group.titles,
        },
      });
    }
    this.log.info({ groups: groups.length, sent }, 'due-soon pushes');
    return sent;
  }

  // The site day whose run is due now, or undefined (before the hour, or already ran today).
  dueDay(lastRunDay: string, now = new Date()): string | undefined {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.siteTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    const day = `${get('year')}-${get('month')}-${get('day')}`;
    if (Number(get('hour')) >= DURATIONS.dueSoonHour && day !== lastRunDay) {
      return day;
    }
    return undefined;
  }
}
