import { ApiRoutes } from '../../../src/constants/api-routes.js';
import { AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auth,
  closeTestContext,
  createTestContext,
  resetDatabase,
  sha,
  type TestContext,
} from '../../helpers/helpers.js';

// F19 (05 §8): leaving the company keeps the company's rows.
describe('DELETE /account', () => {
  let context: TestContext;
  beforeAll(async () => {
    context = await createTestContext();
  });
  afterAll(async () => {
    await closeTestContext(context);
  });
  beforeEach(async () => {
    await resetDatabase(context.pool);
    context.s3.reset();
    context.tokens.deletedUsers = [];
  });

  async function leave(uid: string) {
    return context.app.inject({ method: 'DELETE', url: ApiRoutes.ACCOUNT, headers: auth(uid) });
  }

  it('aborts unfinished uploads, deletes phrases and devices, then the Firebase user', async () => {
    context.s3.on(AbortMultipartUploadCommand).resolves({});
    await context.pool.query(
      `insert into uploads (uid, object_key, sha256, byte_size, content_type, mode, s3_upload_id, part_count)
       values ('bob', 'projects/11111111-1111-4111-8111-111111111111/plans/22222222-2222-4222-8222-222222222222.pdf',
               $1, 9000000, 'application/pdf', 'multipart', 's3-id', 2)`,
      [sha],
    );
    await context.pool.query(
      `insert into phrases (id, uid, rev, client_updated_at, text, usage_count)
       values (gen_random_uuid(), 'bob', 1, now(), 'Crack', 1)`,
    );
    await context.pool.query(
      `insert into devices (token, uid, platform) values ('fX3k:APA91b${'a'.repeat(30)}', 'bob', 'ios')`,
    );
    const response = await leave('bob');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ abortedUploads: 1, deletedRows: 2 });
    expect(context.s3.commandCalls(AbortMultipartUploadCommand)).toHaveLength(1);
    expect(context.tokens.deletedUsers).toEqual(['bob']);
    const member = await context.pool.query(`select removed_at from members where uid = 'bob'`);
    expect(member.rows[0].removed_at).not.toBeNull();
  });

  it('can be called again and finds nothing left', async () => {
    await leave('bob');
    const response = await leave('bob');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ abortedUploads: 0, deletedRows: 0 });
  });

  it('refuses the last Admin with 409 last_admin', async () => {
    const response = await leave('alice');
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('last_admin');
  });
});
