import type { Queryable } from '../data/database.js';

// Phrases are the only personal synced rows (they keep uid).
export class PhraseRepository {
  constructor(private readonly db: Queryable) {}

  async removeAllFor(uid: string): Promise<number> {
    const result = await this.db.query('delete from phrases where uid = $1', [uid]);
    return result.rowCount ?? 0;
  }
}
