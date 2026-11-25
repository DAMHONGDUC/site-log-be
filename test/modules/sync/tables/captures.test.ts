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

describe('captures', () => {
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

  it('keeps the evidence columns of the first insert', async () => {
    await pushAs(context, 'alice', [captureMutation('2026-11-01T08:05:00.000Z', sha)]);
    const changed = captureMutation('2026-11-01T09:00:00.000Z', 'b'.repeat(64));

    changed.fields.excludedFromReport = true;
    const result = await pushAs(context, 'alice', [changed]);

    expect(result.results[0].status).toBe('applied');

    const pulled = await pullAs(context, 'alice', 0);

    expect(pulled.changes.captures[0].sha256).toBe(sha);
    expect(pulled.changes.captures[0].excludedFromReport).toBe(true);
  });

  it('rejects a latitude without a longitude', async () => {
    const mutation = captureMutation('2026-11-01T08:05:00.000Z', sha);

    mutation.fields.latitude = 10.77 as never;
    const result = await pushAs(context, 'alice', [mutation]);

    expect(result.results[0]).toEqual({
      id: ids.capture,
      status: 'rejected',
      reason: 'invalid_row:23514',
    });
  });

  it('rejects the same file twice in one project', async () => {
    await pushAs(context, 'alice', [captureMutation('2026-11-01T08:05:00.000Z', sha)]);
    const copy = captureMutation(
      '2026-11-01T08:06:00.000Z',
      sha,
      '99999999-0000-4000-8000-000000000001',
    );
    const result = await pushAs(context, 'alice', [copy]);

    expect(result.results[0].reason).toBe('invalid_row:23505');
  });
});
