import type { PushKind } from '../constants/push.js';
import type { Queryable } from '../data/database.js';

export type DevicePlatform = 'ios' | 'android';

export interface DeviceRow {
  token: string;
  uid: string;
  platform: DevicePlatform;
}

export class DeviceRepository {
  constructor(private readonly db: Queryable) {}

  // A token moves to whoever signed in last on that phone.
  async register(
    token: string,
    uid: string,
    platform: DevicePlatform,
    kinds: PushKind[] | null,
  ): Promise<void> {
    await this.db.query(
      `insert into devices (token, uid, platform, kinds) values ($1, $2, $3, $4)
       on conflict (token) do update
         set uid = excluded.uid, platform = excluded.platform, kinds = excluded.kinds, updated_at = now()`,
      [token, uid, platform, kinds],
    );
  }

  async removeOwn(token: string, uid: string): Promise<void> {
    await this.db.query('delete from devices where token = $1 and uid = $2', [token, uid]);
  }

  async removeToken(token: string): Promise<void> {
    await this.db.query('delete from devices where token = $1', [token]);
  }

  async removeAllFor(uid: string): Promise<number> {
    const result = await this.db.query('delete from devices where uid = $1', [uid]);
    return result.rowCount ?? 0;
  }

  // Devices of live members that want this kind (kinds null = all).
  async wanting(uids: string[], kind: PushKind): Promise<DeviceRow[]> {
    const result = await this.db.query<DeviceRow>(
      `select d.token, d.uid, d.platform from devices d
         join members m on m.uid = d.uid and m.removed_at is null
        where d.uid = any($1) and (d.kinds is null or $2 = any(d.kinds))`,
      [uids, kind],
    );
    return result.rows;
  }
}
