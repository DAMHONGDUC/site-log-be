import type pg from 'pg';
import type { Logger } from 'pino';
import type { DevicePlatform, PushKind, PushSender } from './fcm.js';

export interface Notification {
  kind: PushKind;
  // Members to tell; the member who caused the event never gets it.
  recipients: string[];
  actorUid: string | null;
  title: string;
  body: string;
  // sitelog://… ; '' when there is nothing to open (removed from a project).
  deepLink: string;
}

interface DeviceRow {
  token: string;
  uid: string;
  platform: DevicePlatform;
}

// Sends one push per device of each recipient that still wants this kind.
// Best effort: a failure is logged, never thrown, so it cannot undo the change that caused it.
export async function notify(
  pool: pg.Pool,
  push: PushSender | undefined,
  log: Logger | { info: Logger['info']; error: Logger['error'] },
  notification: Notification,
): Promise<number> {
  if (push === undefined) {
    return 0;
  }
  const recipients = [...new Set(notification.recipients)].filter(
    (uid) => uid !== notification.actorUid,
  );
  if (recipients.length === 0) {
    return 0;
  }
  let sent = 0;
  try {
    const devices = await pool.query<DeviceRow>(
      `select d.token, d.uid, d.platform from devices d
         join members m on m.uid = d.uid and m.removed_at is null
        where d.uid = any($1) and (d.kinds is null or $2 = any(d.kinds))`,
      [recipients, notification.kind],
    );
    for (const device of devices.rows) {
      try {
        const outcome = await push.send(device.token, device.platform, {
          kind: notification.kind,
          title: notification.title,
          body: notification.body,
          deepLink: notification.deepLink,
          uid: device.uid,
        });
        if (outcome === 'unregistered') {
          await pool.query('delete from devices where token = $1', [device.token]);
        } else {
          sent += 1;
        }
        log.info({ uid: device.uid, kind: notification.kind, outcome }, 'push sent');
      } catch (error) {
        log.error({ err: error, uid: device.uid, kind: notification.kind }, 'push failed');
      }
    }
  } catch (error) {
    log.error({ err: error, kind: notification.kind }, 'push: device lookup failed');
  }
  return sent;
}
