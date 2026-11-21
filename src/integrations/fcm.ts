import { createHash } from 'node:crypto';
import { cert, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Message, type Messaging } from 'firebase-admin/messaging';
import { PUSH_OUTCOME, type PushKind, type PushOutcome } from '../constants/domain/push.js';
import { DEVICE_PLATFORM, type DevicePlatform } from '../constants/data/enums.js';
import { ENCODING, HASH } from '../constants/platform/encoding.js';
import { FCM } from '../constants/platform/external.js';

export type { DevicePlatform } from '../constants/data/enums.js';
export type { PushOutcome } from '../constants/domain/push.js';

export interface PushMessage {
  kind: PushKind;
  title: string;
  body: string;
  deepLink: string;
  uid: string;
}

// Sends one notification. Tests use a fake; production goes through Firebase Cloud Messaging.
export interface PushSender {
  send(token: string, platform: DevicePlatform, message: PushMessage): Promise<PushOutcome>;
}

// Hex characters of the account hash in every push.
const ACCOUNT_HASH_LENGTH = 16;

// The app ignores a push meant for another account signed in earlier on the same phone.
export function hashedAccount(uid: string): string {
  return createHash(HASH.sha256).update(uid).digest(ENCODING.hex).slice(0, ACCOUNT_HASH_LENGTH);
}

// Only a destination: no names, no coordinates.
export function pushMessage(
  token: string,
  platform: DevicePlatform,
  message: PushMessage,
): Message {
  const account = hashedAccount(message.uid);
  if (platform === DEVICE_PLATFORM.ios) {
    return {
      token,
      notification: { title: message.title, body: message.body },
      data: { kind: message.kind, deepLink: message.deepLink, account },
      apns: { payload: { aps: { sound: FCM.apnsSound } } },
    };
  }
  return {
    token,
    data: {
      kind: message.kind,
      deepLink: message.deepLink,
      account,
      title: message.title,
      body: message.body,
    },
    android: { priority: FCM.androidPriority },
  };
}

export class FcmSender implements PushSender {
  private readonly messaging: Messaging;

  constructor(serviceAccountBase64: string) {
    const json = Buffer.from(serviceAccountBase64, ENCODING.base64).toString(ENCODING.utf8);
    const serviceAccount = JSON.parse(json);
    const firebaseApp = initializeApp({ credential: cert(serviceAccount) }, FCM.appName);
    this.messaging = getMessaging(firebaseApp);
  }

  async send(token: string, platform: DevicePlatform, message: PushMessage): Promise<PushOutcome> {
    try {
      await this.messaging.send(pushMessage(token, platform, message));
      return PUSH_OUTCOME.sent;
    } catch (error) {
      const code = (error as { code?: string }).code;
      // The app was removed or the token is stale.
      if (code !== undefined && (FCM.deadTokenErrors as readonly string[]).includes(code)) {
        return PUSH_OUTCOME.unregistered;
      }
      // Anything else (quota, network) goes to the caller, which logs it.
      throw error;
    }
  }
}
