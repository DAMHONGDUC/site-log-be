import type { WorkerDeps } from './verify.js';
import { LOG } from '../constants/messages/log.js';

// Rows per run: the rest wait for the next hourly run.
const BATCH = 100;

// Uploads begun long ago (DURATIONS.abandonedUploadAfter) and never completed: abort them and free
// the parts. (The S3 lifecycle rule does the same for parts; this also closes the rows.)
export async function abortAbandonedUploads(deps: WorkerDeps): Promise<number> {
  const aborted = await deps.services.uploads.abortAbandoned(BATCH);
  deps.log.info({ aborted }, LOG.worker.abandonedChecked);
  return aborted;
}
