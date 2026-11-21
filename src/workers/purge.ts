import type pg from 'pg';
import type { Logger } from 'pino';
import { withTransaction } from '../db.js';
import { syncTables } from '../sync/tables.js';

// Nightly: removes tombstones older than the retention window. Devices whose cursor is older
// than the newest purged rev get `resyncRequired` on their next pull.
export async function purgeTombstones(
  pool: pg.Pool,
  log: Logger,
  retentionDays: number,
): Promise<number> {
  // One transaction for all tables: a purged parent and its purged children leave together.
  return withTransaction(pool, async (client) => {
    let highest = 0;
    let purged = 0;
    for (const table of syncTables) {
      const result = await client.query<{ rev: string }>(
        `delete from ${table.name}
          where deleted_at is not null and deleted_at < now() - make_interval(days => $1)
      returning rev`,
        [retentionDays],
      );
      purged += result.rows.length;
      for (const row of result.rows) {
        highest = Math.max(highest, Number(row.rev));
      }
    }
    if (highest > 0) {
      // One company counter (F19): any device behind this rev must resync.
      await client.query(
        'update sync_counter set purged_through_rev = greatest(purged_through_rev, $1)',
        [highest],
      );
    }
    log.info({ purged, purgedThroughRev: highest }, 'tombstones purged');
    return purged;
  });
}
