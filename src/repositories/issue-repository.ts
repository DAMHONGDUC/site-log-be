import { OPEN_ISSUE_STATUSES } from '../constants/issues.js';
import type { Queryable } from '../data/database.js';

export interface DueSoonGroup {
  assignee_uid: string;
  project_id: string;
  project_name: string;
  count: number;
  titles: string[];
}

export class IssueRepository {
  constructor(private readonly db: Queryable) {}

  // Open issues assigned to a member and due the next day (site time), per assignee and project.
  async dueTomorrowByAssignee(siteTimeZone: string): Promise<DueSoonGroup[]> {
    const result = await this.db.query<DueSoonGroup>(
      `select i.assignee_uid, i.project_id, p.name as project_name, count(*)::int as count,
              array_agg(i.title order by i.severity, i.title) as titles
         from issues i join projects p on p.id = i.project_id
        where i.deleted_at is null and p.deleted_at is null
          and i.assignee_uid is not null
          and i.status = any($2)
          and i.due_date = ((now() at time zone $1)::date + 1)
        group by i.assignee_uid, i.project_id, p.name`,
      [siteTimeZone, OPEN_ISSUE_STATUSES],
    );
    return result.rows;
  }
}
