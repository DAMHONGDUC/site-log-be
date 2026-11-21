import { and, arrayContains, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { DevicePlatform } from '../../constants/enums.js';
import type { PushKind } from '../../constants/push.js';
import type { SqlDb } from '../../data/drizzle.js';
import { devices, members } from '../../data/schema/index.js';

export type { DevicePlatform } from '../../constants/enums.js';

export interface DeviceRow {
  token: string;
  uid: string;
  platform: DevicePlatform;
}

export class DeviceRepository {
  constructor(private readonly db: SqlDb) {}

  // A token moves to whoever signed in last on that phone.
  async register(
    token: string,
    uid: string,
    platform: DevicePlatform,
    kinds: PushKind[] | null,
  ): Promise<void> {
    await this.db
      .insert(devices)
      .values({ token, uid, platform, kinds })
      .onConflictDoUpdate({
        target: devices.token,
        set: { uid, platform, kinds, updatedAt: sql`now()` },
      });
  }

  async removeOwn(token: string, uid: string): Promise<void> {
    await this.db.delete(devices).where(and(eq(devices.token, token), eq(devices.uid, uid)));
  }

  async removeToken(token: string): Promise<void> {
    await this.db.delete(devices).where(eq(devices.token, token));
  }

  async removeAllFor(uid: string): Promise<number> {
    const result = await this.db.delete(devices).where(eq(devices.uid, uid));
    return result.rowCount ?? 0;
  }

  // Devices of live members that want this kind (kinds null = all).
  async wanting(uids: string[], kind: PushKind): Promise<DeviceRow[]> {
    return this.db
      .select({ token: devices.token, uid: devices.uid, platform: devices.platform })
      .from(devices)
      .innerJoin(members, and(eq(members.uid, devices.uid), isNull(members.removedAt)))
      .where(
        and(
          inArray(devices.uid, uids),
          or(isNull(devices.kinds), arrayContains(devices.kinds, [kind])),
        ),
      );
  }
}
