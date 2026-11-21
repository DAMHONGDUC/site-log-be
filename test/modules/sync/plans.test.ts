import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  closeTestContext,
  createTestContext,
  ids,
  resetDatabase,
  sha,
  type TestContext,
} from '../../helpers/helpers.js';
import { pushAs, seedProject } from '../../helpers/sync-helpers.js';
import { beginUpload } from '../../helpers/upload-helpers.js';

const sheetId = '41414141-4141-4141-8141-414141414141';

function sheetMutation() {
  return {
    table: 'plan_sheets',
    id: sheetId,
    op: 'upsert',
    clientUpdatedAt: '2026-11-01T08:00:00.000Z',
    fields: {
      projectId: ids.project,
      locationId: null,
      name: 'Level 2',
      pageIndex: 0,
      pixelWidth: 4000,
      pixelHeight: 3000,
      sha256: sha,
      remoteKey: `projects/${ids.project}/plans/${sheetId}.pdf`,
    },
  };
}

describe('plan sheets', () => {
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

  it('lets a Manager upload a plan and refuses an Inspector of the project (F19)', async () => {
    const key = `projects/${ids.project}/plans/${sheetId}.pdf`;
    const mine = await beginUpload(context, 1000, key);
    expect(mine.statusCode).toBe(200);
    await addMember(context.pool, 'bob', 'inspector', [ids.project]);
    const inspector = await beginUpload(context, 1000, key, 'bob');
    expect(inspector.statusCode).toBe(403);
  });

  it('lets an issue pin to a sheet of the same project', async () => {
    const result = await pushAs(context, 'alice', [sheetMutation()]);
    expect(result.results[0].status).toBe('applied');
    await context.pool.query(
      `insert into issues (id, created_by, rev, client_updated_at, project_id, location_id, title, detail, severity,
                           status, plan_sheet_id, pin_x, pin_y)
       values (gen_random_uuid(), 'alice', 99, now(), $1, $2, 'Leak', '', 'minor', 'open', $3, 0.5, 0.5)`,
      [ids.project, ids.location, sheetId],
    );
    await expect(
      context.pool.query(
        `insert into issues (id, created_by, rev, client_updated_at, project_id, location_id, title, detail, severity,
                             status, plan_sheet_id, pin_x, pin_y)
         values (gen_random_uuid(), 'alice', 99, now(), $1, $2, 'Leak', '', 'minor', 'open', gen_random_uuid(), 0.5, 0.5)`,
        [ids.project, ids.location],
      ),
    ).rejects.toThrow('foreign key');
  });
});
