import { notify } from '../push/notify.js';
import type { WorkerDeps } from './verify.js';

// F19: every day at 8:00 site time, one push per assignee and project with the open issues
// due the next day.
export async function pushDueSoon(deps: WorkerDeps, siteTimeZone: string): Promise<number> {
  const groups = await deps.pool.query<{
    assignee_uid: string;
    project_id: string;
    project_name: string;
    count: string;
    titles: string[];
  }>(
    `select i.assignee_uid, i.project_id, p.name as project_name, count(*)::text as count,
            array_agg(i.title order by i.severity, i.title) as titles
       from issues i join projects p on p.id = i.project_id
      where i.deleted_at is null and p.deleted_at is null
        and i.assignee_uid is not null
        and i.status in ('open', 'inProgress')
        and i.due_date = ((now() at time zone $1)::date + 1)
      group by i.assignee_uid, i.project_id, p.name`,
    [siteTimeZone],
  );
  let sent = 0;
  for (const group of groups.rows) {
    const count = Number(group.count);
    sent += await notify(deps.pool, deps.push, deps.log, {
      kind: 'dueSoon',
      recipients: [group.assignee_uid],
      actorUid: null,
      title: count === 1 ? '1 issue due tomorrow' : `${count} issues due tomorrow`,
      body: `${group.project_name} · ${group.titles.slice(0, 2).join(', ')}`,
      deepLink: `sitelog://project/${group.project_id}`,
    });
  }
  deps.log.info({ groups: groups.rows.length, sent }, 'due-soon pushes');
  return sent;
}

// Has the 8:00 run of today (site time) not happened yet?
export function dueSoonIsDue(
  lastRunDay: string,
  siteTimeZone: string,
  now = new Date(),
): string | undefined {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: siteTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const day = `${get('year')}-${get('month')}-${get('day')}`;
  if (Number(get('hour')) >= 8 && day !== lastRunDay) {
    return day;
  }
  return undefined;
}
