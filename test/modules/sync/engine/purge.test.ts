import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../../../src/core/logger.js';
import { purgeTombstones } from '../../../../src/workers/purge.js';
import {
  closeTestContext,
  createTestContext,
  ids,
  resetDatabase,
  type TestContext,
} from '../../../helpers/helpers.js';
import {
  locationMutation,
  projectMutation,
  pullAs,
  pushAs,
} from '../../../helpers/sync-helpers.js';

describe('tombstone purge', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext();
  });
  afterAll(async () => {
    await closeTestContext(context);
  });
  beforeEach(async () => {
    await resetDatabase(context.pool);
  });

  it('removes old tombstones with their children and moves the resync watermark', async () => {
    await pushAs(context, 'alice', [
      projectMutation(ids.project, '2026-11-01T08:00:00.000Z', 'Tower A'),
      locationMutation('2026-11-01T08:00:00.000Z', 'L1'),
    ]);
    await context.pool.query(`update projects set deleted_at = now() - interval '100 days'`);
    await context.pool.query(`update locations set deleted_at = now() - interval '100 days'`);

    const purged = await purgeTombstones(context.pool, createLogger('silent'), 90);

    expect(purged).toBe(2);
    const pulled = await pullAs(context, 'alice', 1);

    expect(pulled).toEqual({ resyncRequired: true });
  });

  it('keeps recent tombstones', async () => {
    await pushAs(context, 'alice', [
      projectMutation(ids.project, '2026-11-01T08:00:00.000Z', 'Tower A'),
    ]);
    await context.pool.query(`update projects set deleted_at = now() - interval '10 days'`);
    expect(await purgeTombstones(context.pool, createLogger('silent'), 90)).toBe(0);
  });
});
