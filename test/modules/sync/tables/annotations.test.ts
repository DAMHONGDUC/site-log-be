import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  closeTestContext,
  createTestContext,
  ids,
  resetDatabase,
  sha,
  type TestContext,
} from '../../../helpers/helpers.js';
import { captureMutation, pullAs, pushAs, seedProject } from '../../../helpers/sync-helpers.js';

function annotationMutation(clientUpdatedAt: string, shapes: object[]) {
  // The annotation id is the capture id: one layer per photo.
  return {
    table: 'annotations',
    id: ids.capture,
    op: 'upsert',
    clientUpdatedAt,
    fields: { shapes },
  };
}

describe('annotations', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext();
  });
  afterAll(async () => {
    await closeTestContext(context);
  });
  beforeEach(async () => {
    await resetDatabase(context.pool);
    await seedProject(context);
  });

  it('stores shapes as JSON and returns them as sent', async () => {
    const shapes = [{ kind: 'arrow', from: [0.1, 0.2], to: [0.4, 0.5], color: '#FF3B30' }];

    await pushAs(context, 'alice', [
      captureMutation('2026-11-01T08:05:00.000Z', sha),
      annotationMutation('2026-11-01T08:06:00.000Z', shapes),
    ]);
    const pulled = await pullAs(context, 'alice', 0);

    expect(pulled.changes.annotations[0].shapes).toEqual(shapes);
  });

  it('rejects a layer for a photo that does not exist', async () => {
    const result = await pushAs(context, 'alice', [
      annotationMutation('2026-11-01T08:06:00.000Z', []),
    ]);

    expect(result.results[0]).toEqual({
      id: ids.capture,
      status: 'rejected',
      reason: 'missing_parent',
    });
  });
});
