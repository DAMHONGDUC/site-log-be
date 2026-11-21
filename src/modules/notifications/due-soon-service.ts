import { DURATIONS } from '../../constants/runtime/durations.js';
import type { Database } from '../../data/database.js';
import type { Log } from '../../core/log.js';
import type { NotificationService } from './notification-service.js';
import { PUSH_KIND } from '../../constants/domain/push.js';
import { LOG } from '../../constants/messages/log.js';
import { SITE_CLOCK } from '../../constants/runtime/units.js';

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
        kind: PUSH_KIND.dueSoon,
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
    this.log.info({ groups: groups.length, sent }, LOG.push.dueSoon);
    return sent;
  }

  // The site day whose run is due now, or undefined (before the hour, or already ran today).
  dueDay(lastRunDay: string, now = new Date()): string | undefined {
    const parts = new Intl.DateTimeFormat(SITE_CLOCK.locale, {
      ...SITE_CLOCK.options,
      timeZone: this.siteTimeZone,
    }).formatToParts(now);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    const { part } = SITE_CLOCK;
    const day = [get(part.year), get(part.month), get(part.day)].join(SITE_CLOCK.dateSeparator);
    if (Number(get(part.hour)) >= DURATIONS.dueSoonHour && day !== lastRunDay) {
      return day;
    }
    return undefined;
  }
}
