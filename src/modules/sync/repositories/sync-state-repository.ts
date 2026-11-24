import { and, isNotNull, lt, sql } from 'drizzle-orm';
import type { SqlDb } from '../../../data/drizzle.js';
import { SYNCED_TABLES, syncCounter } from '../../../data/schema/index.js';
import { daysAgo } from '../../../data/sql-time.js';

export interface PurgeResult {
  purged: number;
  // The newest rev removed; 0 when nothing was.
  highestRev: number;
}

// The company rev counter (one row, F19) and the tombstones it tracks.
export class SyncStateRepository {
  constructor(private readonly db: SqlDb) {}

  // Every other push in the company waits on this row lock, so revs commit in order.
  async lockCounter(): Promise<void> {
    await this.db.select({ lastRev: syncCounter.lastRev }).from(syncCounter).for('update');
  }

  async nextRev(): Promise<number> {
    const [row] = await this.db
      .update(syncCounter)
      .set({ lastRev: sql`${syncCounter.lastRev} + 1` })
      .returning({ lastRev: syncCounter.lastRev });

    return row!.lastRev;
  }

  async currentRev(): Promise<number> {
    const [row] = await this.db.select({ lastRev: syncCounter.lastRev }).from(syncCounter);

    return row?.lastRev ?? 0;
  }

  async purgedThroughRev(): Promise<number> {
    const [row] = await this.db
      .select({ purgedThroughRev: syncCounter.purgedThroughRev })
      .from(syncCounter);

    return row?.purgedThroughRev ?? 0;
  }

  // Removes tombstones older than the retention window from every synced table. Run it in one
  // transaction: a purged parent and its purged children leave together.
  async purgeTombstones(retentionDays: number): Promise<PurgeResult> {
    const cutoff = daysAgo(retentionDays);
    let purged = 0;
    let highestRev = 0;

    for (const table of Object.values(SYNCED_TABLES)) {
      const rows = await this.db
        .delete(table)
        .where(and(isNotNull(table.deletedAt), lt(table.deletedAt, cutoff)))
        .returning({ rev: table.rev });

      purged += rows.length;
      for (const row of rows) {
        highestRev = Math.max(highestRev, row.rev);
      }
    }
    if (highestRev > 0) {
      // Any device whose cursor is behind this rev must resync.
      await this.db
        .update(syncCounter)
        .set({ purgedThroughRev: sql`greatest(${syncCounter.purgedThroughRev}, ${highestRev})` });
    }

    return { purged, highestRev };
  }
}
