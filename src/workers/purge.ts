import type pg from 'pg';
import type { Logger } from 'pino';
import { withTransaction } from '../data/pool.js';
import { createRepositories } from '../data/repositories.js';
import { LOG } from '../constants/messages/log.js';

// Nightly: removes tombstones older than the retention window. Devices whose cursor is older
// than the newest purged rev get `resyncRequired` on their next pull.
export async function purgeTombstones(
  pool: pg.Pool,
  log: Logger,
  retentionDays: number,
): Promise<number> {
  const { purged, highestRev } = await withTransaction(pool, (client) =>
    createRepositories(client).syncState.purgeTombstones(retentionDays),
  );

  log.info({ purged, purgedThroughRev: highestRev }, LOG.worker.tombstonesPurged);

  return purged;
}
