import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  closeTestContext,
  createTestContext,
  ids,
  resetDatabase,
  type TestContext,
} from '../../../helpers/helpers.js';
import { pushAs, seedProject } from '../../../helpers/sync-helpers.js';

const templateId = '51515151-5151-4151-8151-515151515151';
const itemId = '52525252-5252-4252-8252-525252525252';
const runId = '53535353-5353-4353-8353-535353535353';
const at = '2026-11-01T09:00:00.000Z';

function resultMutation(id: string, outcome: string, clientUpdatedAt: string = at) {
  return {
    table: 'checklist_results',
    id,
    op: 'upsert',
    clientUpdatedAt,
    fields: {
      runId,
      templateItemId: itemId,
      outcome,
      note: '',
      issueId: null,
      answeredAt: clientUpdatedAt,
    },
  };
}

describe('checklists', () => {
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
    await pushAs(context, 'alice', [
      {
        table: 'checklist_templates',
        id: templateId,
        op: 'upsert',
        clientUpdatedAt: at,
        fields: {
          projectId: null,
          name: 'Pre-pour',
          appliesTo: 'floor',
          isBuiltIn: true,
          usageCount: 0,
        },
      },
      {
        table: 'checklist_template_items',
        id: itemId,
        op: 'upsert',
        clientUpdatedAt: at,
        fields: {
          templateId,
          ordinal: 1,
          text: 'Rebar spacing',
          defaultSeverity: 'major',
          requiresPhotoOnFail: true,
        },
      },
      {
        table: 'checklist_runs',
        id: runId,
        op: 'upsert',
        clientUpdatedAt: at,
        fields: {
          templateId,
          sessionId: ids.session,
          locationId: ids.location,
          startedAt: at,
          completedAt: null,
        },
      },
    ]);
  });

  it('keeps one answer per item: a second device adopts the stored answer', async () => {
    const first = await pushAs(context, 'alice', [
      resultMutation('54545454-5454-4454-8454-545454545454', 'pass'),
    ]);
    expect(first.results[0].status).toBe('applied');
    const second = await pushAs(context, 'alice', [
      resultMutation('55555555-0000-4000-8000-555555555555', 'fail'),
    ]);
    expect(second.results[0].status).toBe('superseded');
    expect(second.results[0].serverRow.outcome).toBe('pass');
  });

  it('changes an answer through the same row, last write wins', async () => {
    await pushAs(context, 'alice', [
      resultMutation('54545454-5454-4454-8454-545454545454', 'pass'),
    ]);
    const changed = await pushAs(context, 'alice', [
      resultMutation('54545454-5454-4454-8454-545454545454', 'fail', '2026-11-01T10:00:00.000Z'),
    ]);
    expect(changed.results[0].status).toBe('applied');
  });
});
