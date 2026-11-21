import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestContext, createTestContext, resetDatabase, type TestContext } from './helpers.js';
import { pushAs } from './sync-helpers.js';

function brandingMutation(id: string, companyName: string) {
  return {
    table: 'report_branding',
    id,
    op: 'upsert',
    clientUpdatedAt: '2026-11-01T08:00:00.000Z',
    fields: { companyName, logoKey: null, accentHex: '#1A73E8', clientBlock: '', footerText: '' },
  };
}

describe('report branding', () => {
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

  it('keeps one row per user: a second device adopts the first one', async () => {
    await pushAs(context, 'alice', [
      brandingMutation('31313131-3131-4131-8131-313131313131', 'DD Build'),
    ]);
    const second = await pushAs(context, 'alice', [
      brandingMutation('32323232-3232-4232-8232-323232323232', 'Other'),
    ]);
    expect(second.results[0].status).toBe('superseded');
    expect(second.results[0].serverRow.companyName).toBe('DD Build');
  });

  it('rejects a colour that is not #RRGGBB', async () => {
    const mutation = brandingMutation('31313131-3131-4131-8131-313131313131', 'DD Build');
    mutation.fields.accentHex = 'blue';
    const result = await pushAs(context, 'alice', [mutation]);
    expect(result.results[0].reason).toBe('invalid_row:23514');
  });
});
