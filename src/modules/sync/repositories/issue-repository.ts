import { and, count, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { OPEN_ISSUE_STATUSES } from '../../../constants/domain/issues.js';
import type { SqlDb } from '../../../data/drizzle.js';
import { issues, projects } from '../../../data/schema/index.js';

export interface DueSoonGroup {
  assigneeUid: string;
  projectId: string;
  projectName: string;
  count: number;
  titles: string[];
}

export class IssueRepository {
  constructor(private readonly db: SqlDb) {}

  // Open issues assigned to a member and due the next day (site time), per assignee and project.
  async dueTomorrowByAssignee(siteTimeZone: string): Promise<DueSoonGroup[]> {
    const rows = await this.db
      .select({
        assigneeUid: issues.assigneeUid,
        projectId: issues.projectId,
        projectName: projects.name,
        count: count(),
        titles: sql<
          string[]
        >`array_agg(${issues.title} order by ${issues.severity}, ${issues.title})`,
      })
      .from(issues)
      .innerJoin(projects, eq(projects.id, issues.projectId))
      .where(
        and(
          isNull(issues.deletedAt),
          isNull(projects.deletedAt),
          isNotNull(issues.assigneeUid),
          inArray(issues.status, [...OPEN_ISSUE_STATUSES]),
          eq(issues.dueDate, sql`((now() at time zone ${siteTimeZone})::date + 1)`),
        ),
      )
      .groupBy(issues.assigneeUid, issues.projectId, projects.name);
    // The where clause keeps only assigned issues.
    return rows.map((row) => ({ ...row, assigneeUid: row.assigneeUid! }));
  }
}
