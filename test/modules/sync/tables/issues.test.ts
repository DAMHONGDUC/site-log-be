import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  closeTestContext,
  createTestContext,
  ids,
  resetDatabase,
  type TestContext,
} from '../../../helpers/helpers.js';
import { pushAs, seedProject } from '../../../helpers/sync-helpers.js';

const issueId = '12121212-1212-4212-8212-121212121212';

function issueMutation(fields: Record<string, unknown> = {}) {
  return {
    table: 'issues',
    id: issueId,
    op: 'upsert',
    clientUpdatedAt: '2026-11-01T09:00:00.000Z',
    fields: {
      projectId: ids.project,
      locationId: ids.location,
      title: 'Crack in slab',
      detail: '',
      severity: 'major',
      status: 'open',
      dueDate: '2026-11-20',
      assigneeName: null,
      trade: null,
      planSheetId: null,
      pinX: null,
      pinY: null,
      resolvedByIssueId: null,
      sourceChecklistResultId: null,
      ...fields,
    },
  };
}

function phraseMutation(id: string) {
  return {
    table: 'phrases',
    id,
    op: 'upsert',
    clientUpdatedAt: '2026-11-01T08:00:00.000Z',
    fields: { text: 'Crack in slab', usageCount: 1 },
  };
}

describe('issues and phrases', () => {
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

  it('stores an issue with a plain date', async () => {
    const result = await pushAs(context, 'alice', [issueMutation()]);

    expect(result.results[0].status).toBe('applied');
    const row = await context.pool.query('select due_date from issues');

    expect(row.rows[0].due_date).toBe('2026-11-20');
  });

  it('rejects an unknown severity and a half pin', async () => {
    const badSeverity = await pushAs(context, 'alice', [issueMutation({ severity: 'huge' })]);

    expect(badSeverity.results[0].reason).toBe('invalid_row:23514');
    const halfPin = await pushAs(context, 'alice', [issueMutation({ pinX: 0.5 })]);

    expect(halfPin.results[0].reason).toBe('invalid_row:23514');
  });

  it('merges a phrase typed on two devices into one row', async () => {
    await pushAs(context, 'alice', [phraseMutation('99999999-9999-4999-8999-999999999991')]);
    const result = await pushAs(context, 'alice', [
      phraseMutation('99999999-9999-4999-8999-999999999992'),
    ]);

    expect(result.results[0].status).toBe('superseded');
    expect(result.results[0].serverRow.id).toBe('99999999-9999-4999-8999-999999999991');
  });
});
