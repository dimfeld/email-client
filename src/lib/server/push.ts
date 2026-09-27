import type { DatabaseSync } from 'node:sqlite';
import webpush, { WebPushError, type PushSubscription } from 'web-push';
import type { EmailPushPayload } from '$lib/push';
import { senderName } from '$lib/mail-list';
import { deletePushSubscription, getEmailRowId, listPushSubscriptions } from './db';
import type { Importance } from '$lib/categories';
import type { IncomingEmail } from './types';

export type EmailNotifier = (
  database: DatabaseSync,
  accountEmail: string,
  emails: IncomingEmail[]
) => Promise<void>;

type SendPush = (subscription: PushSubscription, payload: string) => Promise<unknown>;

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

function vapidDetails() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

const defaultSend: SendPush = (subscription, payload) => {
  const details = vapidDetails();
  if (!details) return Promise.resolve();
  return webpush.sendNotification(subscription, payload, { vapidDetails: details });
};

/** New unread inbox email that Jev marks important or useful sends a notification. */
export function shouldNotify(email: IncomingEmail, importance: Importance | null): boolean {
  return (
    (importance === 'important' || importance === 'useful') &&
    Boolean(email.labels?.includes('INBOX')) &&
    Boolean(email.labels?.includes('UNREAD'))
  );
}

export function emailPushPayload(email: IncomingEmail, rowId: number | null): EmailPushPayload {
  return {
    title: senderName(email.from ?? ''),
    body: email.subject || '(no subject)',
    url: rowId === null ? '/' : `/?message=${rowId}`,
    tag: email.threadId ?? email.id,
  };
}

/** Sends one notification for each email to every saved subscription. */
export async function sendEmailPushNotifications(
  database: DatabaseSync,
  accountEmail: string,
  emails: IncomingEmail[],
  send: SendPush = defaultSend
): Promise<void> {
  if (emails.length === 0) return;
  const subscriptions = listPushSubscriptions(database);
  if (subscriptions.length === 0) return;
  for (const email of emails) {
    const payload = JSON.stringify(
      emailPushPayload(email, getEmailRowId(database, accountEmail, email.id))
    );
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await send(subscription, payload);
        } catch (error) {
          // The push service returns 404 or 410 for a subscription that is no longer valid.
          if (
            error instanceof WebPushError &&
            (error.statusCode === 404 || error.statusCode === 410)
          ) {
            deletePushSubscription(database, subscription.endpoint);
          } else {
            console.error('Web Push notification failed.', {
              endpoint: subscription.endpoint,
              error,
            });
          }
        }
      })
    );
  }
}
