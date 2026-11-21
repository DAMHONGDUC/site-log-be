import type { Database } from '../../data/database.js';
import type { Log } from '../../core/log.js';
import type { Storage } from '../../integrations/storage.js';

const LEGACY_KEY = /^([A-Za-z0-9]{1,128})\/(.+)$/;
const BRANDING_PREFIX = 'branding/';
export const KEY_PREFIX = { project: 'projects/', company: 'company/' } as const;

// F19: before team and roles, keys started with the uploader's uid: "{uid}/{projectId}/…" and
// "{uid}/branding/…". They move to "projects/{projectId}/…" and "company/branding/…".
export function newKeyFor(oldKey: string): string | undefined {
  if (oldKey.startsWith(KEY_PREFIX.project) || oldKey.startsWith(KEY_PREFIX.company)) {
    return undefined;
  }
  const match = LEGACY_KEY.exec(oldKey);
  if (match === null) {
    return undefined;
  }
  const rest = match[2]!;
  return rest.startsWith(BRANDING_PREFIX)
    ? `${KEY_PREFIX.company}${rest}`
    : `${KEY_PREFIX.project}${rest}`;
}

// Copies each old object, points every row at the new key, then deletes the old object.
// Resumable: rows already moved are skipped; a crash between copy and delete leaves a copy only.
export class KeyMigrationService {
  constructor(
    private readonly db: Database,
    private readonly storage: Storage,
    private readonly log: Log,
  ) {}

  async run(): Promise<number> {
    let moved = 0;
    for (const upload of await this.db.repos.uploads.completedWithLegacyKeys()) {
      const newKey = newKeyFor(upload.objectKey);
      if (newKey === undefined) {
        continue;
      }
      await this.storage.copyObject(upload.objectKey, newKey);
      await this.db.transaction((repos) =>
        repos.uploads.renameKey(upload.id, upload.objectKey, newKey),
      );
      await this.storage.deleteObject(upload.objectKey);
      moved += 1;
      this.log.info({ from: upload.objectKey, to: newKey }, 'key moved');
    }
    this.log.info({ moved }, 'move keys done');
    return moved;
  }
}
