import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { FastifyBaseLogger } from 'fastify';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

// Sends one plain-text email. Tests and local runs without a sender use LogMailer.
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export class SesMailer implements Mailer {
  private readonly client: SESv2Client;
  private readonly from: string;

  constructor(region: string, from: string) {
    this.client = new SESv2Client({ region });
    this.from = from;
  }

  async send(message: MailMessage): Promise<void> {
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject },
            Body: { Text: { Data: message.text } },
          },
        },
      }),
    );
  }
}

// No sender configured: write the message to the log instead (the link is in it).
export class LogMailer implements Mailer {
  sent: MailMessage[] = [];
  private readonly log: FastifyBaseLogger | undefined;

  constructor(log?: FastifyBaseLogger) {
    this.log = log;
  }

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    this.log?.info(
      { to: message.to, subject: message.subject },
      'mail (not sent: no sender configured)',
    );
  }
}
