import type pg from 'pg';
import type { Member, Reach, AccessService } from '../team/index.js';
import type { Repositories } from '../../data/repositories.js';
import { rowToJson } from './case.js';
import { syncTables, type SyncTable } from './tables.js';
import { SYNC_SCOPE } from '../../constants/data/sync.js';
import { REACH_ALL } from '../../constants/domain/team.js';

export type PullResult =
  | { resyncRequired: true }
  | {
      resyncRequired: false;
      changes: Record<string, Record<string, unknown>[]>;
      nextRev: number;
      hasMore: boolean;
    };

interface ChangedRow {
  table: string;
  rev: number;
  row: Record<string, unknown>;
}

// The rows of one table this member may see, after `since`.
function scopedQuery(
  table: SyncTable,
  member: Member,
  reach: Reach,
  since: number,
  limit: number,
): { sql: string; values: unknown[] } {
  const base = `select * from ${table.name} where rev > $1`;
  const order = 'order by rev limit $2';

  if (table.scope === SYNC_SCOPE.personal) {
    return { sql: `${base} and uid = $3 ${order}`, values: [since, limit + 1, member.uid] };
  }
  if (table.scope === SYNC_SCOPE.company || reach === REACH_ALL) {
    return { sql: `${base} ${order}`, values: [since, limit + 1] };
  }
  if (table.scope === SYNC_SCOPE.projects) {
    return { sql: `${base} and id = any($3) ${order}`, values: [since, limit + 1, reach] };
  }
  const optional = table.projectOptional ? 'project_id is null or ' : '';

  return {
    sql: `${base} and (${optional}project_id = any($3)) ${order}`,
    values: [since, limit + 1, reach],
  };
}

// Everything this member may see that changed after `since`, oldest first, at most `limit` rows.
// Tombstones (deleted_at set) are included so other devices delete them too.
export async function pullChanges(
  pool: pg.Pool,
  repos: Repositories,
  access: AccessService,
  member: Member,
  since: number,
  limit: number,
): Promise<PullResult> {
  if (member.resyncRequired) {
    // Access changed (role or projects): the device rebuilds its store from 0.
    await repos.members.clearResync(member.uid);

    return { resyncRequired: true };
  }
  if (since > 0 && since < (await repos.syncState.purgedThroughRev())) {
    // Tombstones this device never saw are gone: it must start again from 0.
    return { resyncRequired: true };
  }

  const reach = await access.reach(member);
  // Revs are unique company-wide, so the first `limit` rows across all tables are found by
  // taking limit + 1 from each table and merging.
  const found: ChangedRow[] = [];

  for (const table of syncTables) {
    const query = scopedQuery(table, member, reach, since, limit);
    const result = await pool.query(query.sql, query.values);

    for (const row of result.rows) {
      found.push({ table: table.name, rev: Number(row.rev), row });
    }
  }
  found.sort((a, b) => a.rev - b.rev);

  const page = found.slice(0, limit);
  const hasMore = found.length > limit;

  const changes: Record<string, Record<string, unknown>[]> = {};
  let nextRev = since;

  for (const item of page) {
    if (changes[item.table] === undefined) {
      changes[item.table] = [];
    }
    changes[item.table]!.push(rowToJson(item.row));
    nextRev = item.rev;
  }

  return { resyncRequired: false, changes, nextRev, hasMore };
}
