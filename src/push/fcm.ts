import { createHash } from 'node:crypto';
import { cert, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Message, type Messaging } from 'firebase-admin/messaging';

export type DevicePlatform = 'ios' | 'android';
export type PushOutcome = 'sent' | 'unregistered';

// The push kinds of 01-api §10. A device lists the kinds it wants (null = all).
export type PushKind =
  'uploadsVerified' | 'issueAssigned' | 'issueRechecked' | 'dueSoon' | 'access';

export const PUSH_KINDS: PushKind[] = [
  'uploadsVerified',
  'issueAssigned',
  'issueRechecked',
  'dueSoon',
  'access',
];

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

// The app ignores a push meant for another account signed in earlier on the same phone.
export function hashedAccount(uid: string): string {
  return createHash('sha256').update(uid).digest('hex').slice(0, 16);
}

// Only a destination: no names, no coordinates.
export function pushMessage(
  token: string,
  platform: DevicePlatform,
  message: PushMessage,
): Message {
  const account = hashedAccount(message.uid);
  if (platform === 'ios') {
    return {
      token,
      notification: { title: message.title, body: message.body },
      data: { kind: message.kind, deepLink: message.deepLink, account },
      apns: { payload: { aps: { sound: 'default' } } },
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
    android: { priority: 'high' },
  };
}

// FCM answers with these codes when the app was removed or the token is stale.
const UNREGISTERED_CODES = [
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
];

export class FcmSender implements PushSender {
  private readonly messaging: Messaging;

  constructor(serviceAccountBase64: string) {
    const json = Buffer.from(serviceAccountBase64, 'base64').toString('utf8');
    const serviceAccount = JSON.parse(json);
    const firebaseApp = initializeApp({ credential: cert(serviceAccount) }, 'push');
    this.messaging = getMessaging(firebaseApp);
  }

  async send(token: string, platform: DevicePlatform, message: PushMessage): Promise<PushOutcome> {
    try {
      await this.messaging.send(pushMessage(token, platform, message));
      return 'sent';
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      if (UNREGISTERED_CODES.includes(code)) {
        return 'unregistered';
      }
      // Anything else (quota, network) goes to the caller, which logs it.
      throw error;
    }
  }
}
