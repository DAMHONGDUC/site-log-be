import type pg from 'pg';
import type { Logger } from 'pino';
import type { Storage } from '../storage.js';

// F19: before team and roles, keys started with the uploader's uid: "{uid}/{projectId}/…" and
// "{uid}/branding/…". They move to "projects/{projectId}/…" and "company/branding/…".
const OLD = /^([A-Za-z0-9]{1,128})\/(.+)$/;

export function newKeyFor(oldKey: string): string | undefined {
  if (oldKey.startsWith('projects/') || oldKey.startsWith('company/')) {
    return undefined;
  }
  const match = OLD.exec(oldKey);
  if (match === null) {
    return undefined;
  }
  const rest = match[2]!;
  if (rest.startsWith('branding/')) {
    return `company/${rest}`;
  }
  return `projects/${rest}`;
}

// Copies each old object, points every row at the new key, then deletes the old object.
// Resumable: rows already moved are skipped; a crash between copy and delete only leaves a copy.
export async function moveKeys(pool: pg.Pool, storage: Storage, log: Logger): Promise<number> {
  const uploads = await pool.query<{ id: string; object_key: string }>(
    `select id, object_key from uploads
      where state = 'completed' and object_key not like 'projects/%' and object_key not like 'company/%'
      order by completed_at`,
  );
  let moved = 0;
  for (const upload of uploads.rows) {
    const newKey = newKeyFor(upload.object_key);
    if (newKey === undefined) {
      continue;
    }
    await storage.copyObject(upload.object_key, newKey);
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('update uploads set object_key = $2 where id = $1', [upload.id, newKey]);
      for (const [table, column] of [
        ['captures', 'remote_key'],
        ['plan_sheets', 'remote_key'],
        ['report_branding', 'logo_key'],
      ] as const) {
        await client.query(`update ${table} set ${column} = $2 where ${column} = $1`, [
          upload.object_key,
          newKey,
        ]);
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    await storage.deleteObject(upload.object_key);
    moved += 1;
    log.info({ from: upload.object_key, to: newKey }, 'key moved');
  }
  log.info({ moved }, 'move keys done');
  return moved;
}
