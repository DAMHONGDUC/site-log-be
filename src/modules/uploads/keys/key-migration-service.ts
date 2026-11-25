import type { Database } from '../../../data/database.js';
import type { Log } from '../../../core/log.js';
import type { Storage } from '../../../integrations/storage.js';
import { KEY_ROOT, LEGACY_KEY } from '../../../constants/domain/object-keys.js';
import { LOG } from '../../../constants/messages/log.js';

// F19: before team and roles, keys started with the uploader's uid: "{uid}/{projectId}/…" and
// "{uid}/branding/…". They move to "projects/{projectId}/…" and "company/branding/…".
export function newKeyFor(oldKey: string): string | undefined {
  if (oldKey.startsWith(KEY_ROOT.projects) || oldKey.startsWith(KEY_ROOT.company)) {
    return undefined;
  }
  const match = LEGACY_KEY.shape.exec(oldKey);

  if (match === null) {
    return undefined;
  }
  const rest = match[2]!;

  return (rest.startsWith(LEGACY_KEY.brandingFolder) ? KEY_ROOT.company : KEY_ROOT.projects) + rest;
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
      this.log.info({ from: upload.objectKey, to: newKey }, LOG.uploads.keyMoved);
    }
    this.log.info({ moved }, LOG.uploads.moveKeysDone);

    return moved;
  }
}
