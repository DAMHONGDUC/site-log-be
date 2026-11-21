import { eq } from 'drizzle-orm';
import type { SqlDb } from '../../data/drizzle.js';
import { phrases } from '../../data/schema/index.js';

// Phrases are the only personal synced rows (they keep uid).
export class PhraseRepository {
  constructor(private readonly db: SqlDb) {}

  async removeAllFor(uid: string): Promise<number> {
    const result = await this.db.delete(phrases).where(eq(phrases.uid, uid));
    return result.rowCount ?? 0;
  }
}
