import { type PushKind, PUSH_OUTCOME } from '../../constants/domain/push.js';
import type { Database } from '../../data/database.js';
import type { Log } from '../../core/log.js';
import type { PushSender } from '../../integrations/fcm.js';
import { PUSH_TEMPLATES, type PushData } from './push-templates.js';
import { LOG } from '../../constants/messages/log.js';

export interface Delivery<K extends PushKind> {
  kind: K;
  // Members to tell; the member who caused the event never gets it.
  recipients: string[];
  actorUid: string | null;
  data: PushData[K];
}

// Sends one push per device of each recipient that still wants the kind. Best effort: a failure
// is logged, never thrown, so it cannot undo the change that caused it.
export class NotificationService {
  constructor(
    private readonly db: Database,
    private readonly push: PushSender | undefined,
    private readonly log: Log,
  ) {}

  async send<K extends PushKind>(delivery: Delivery<K>): Promise<number> {
    if (this.push === undefined) {
      return 0;
    }
    const recipients = [...new Set(delivery.recipients)].filter(
      (uid) => uid !== '' && uid !== delivery.actorUid,
    );
    if (recipients.length === 0) {
      return 0;
    }
    const content = PUSH_TEMPLATES[delivery.kind](delivery.data);
    let sent = 0;
    try {
      const devices = await this.db.repos.devices.wanting(recipients, delivery.kind);
      for (const device of devices) {
        try {
          const outcome = await this.push.send(device.token, device.platform, {
            kind: delivery.kind,
            ...content,
            uid: device.uid,
          });
          if (outcome === PUSH_OUTCOME.unregistered) {
            await this.db.repos.devices.removeToken(device.token);
          } else {
            sent += 1;
          }
          this.log.info({ uid: device.uid, kind: delivery.kind, outcome }, LOG.push.sent);
        } catch (error) {
          this.log.error({ err: error, uid: device.uid, kind: delivery.kind }, LOG.push.failed);
        }
      }
    } catch (error) {
      this.log.error({ err: error, kind: delivery.kind }, LOG.push.deviceLookupFailed);
    }
    return sent;
  }
}
