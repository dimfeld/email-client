import type { DatabaseSync } from 'node:sqlite';
import webpush, { WebPushError, type PushSubscription } from 'web-push';
import type { PushPayload } from '$lib/push';
import { senderName } from '$lib/mail-list';
import { deletePushSubscription, getEmailRowId, listPushSubscriptions } from './db';
import type { Importance } from '$lib/categories';
import type { IncomingEmail } from './types';

export type EmailNotifier = (
  database: DatabaseSync,
  accountEmail: string,
  emails: IncomingEmail[]
) => Promise<void>;

export type SendPush = (subscription: PushSubscription, payload: string) => Promise<unknown>;

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

export function emailPushPayload(email: IncomingEmail, rowId: number | null): PushPayload {
  return {
    title: senderName(email.from ?? ''),
    body: email.subject || '(no subject)',
    url: rowId === null ? '/' : `/?message=${rowId}`,
    tag: email.threadId ?? email.id,
  };
}

/** One email gets its own notification. More emails get one notification with the count. */
export function emailBatchPushPayload(
  emails: IncomingEmail[],
  rowId: (email: IncomingEmail) => number | null
): PushPayload {
  if (emails.length === 1) return emailPushPayload(emails[0], rowId(emails[0]));
  const senders = new Set(emails.map((email) => senderName(email.from ?? '')));
  return {
    title: senders.size === 1 ? [...senders][0] : 'New email',
    body: `${emails.length} new emails`,
    url: '/',
    tag: 'new-emails',
  };
}

export const EMAIL_PUSH_DEBOUNCE_MS = 15_000;

/**
 * Waits `delayMs` before it sends a notification. Each new email starts the wait again.
 * All emails that arrive during the wait go into one notification.
 */
export function createDebouncedEmailNotifier(
  delayMs = EMAIL_PUSH_DEBOUNCE_MS,
  send: SendPush = defaultSend
): EmailNotifier {
  let pending: Array<{ database: DatabaseSync; accountEmail: string; email: IncomingEmail }> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function flush() {
    const batch = pending;
    pending = [];
    timer = undefined;
    if (batch.length === 0) return;
    const { database } = batch[0];
    const accounts = new Map(batch.map((item) => [item.email, item.accountEmail]));
    const payload = emailBatchPushPayload(
      batch.map((item) => item.email),
      (email) => getEmailRowId(database, accounts.get(email)!, email.id)
    );
    await sendPushNotifications(database, [payload], send);
  }

  return async (database, accountEmail, emails) => {
    if (emails.length === 0) return;
    pending.push(...emails.map((email) => ({ database, accountEmail, email })));
    clearTimeout(timer);
    timer = setTimeout(() => {
      flush().catch((error) => console.error('Email push notifications failed.', error));
    }, delayMs);
    timer.unref?.();
  };
}

export const notifyNewEmails: EmailNotifier = createDebouncedEmailNotifier();

/** Sends each payload to every saved subscription. */
export async function sendPushNotifications(
  database: DatabaseSync,
  payloads: PushPayload[],
  send: SendPush = defaultSend
): Promise<void> {
  if (payloads.length === 0) return;
  const subscriptions = listPushSubscriptions(database);
  if (subscriptions.length === 0) return;
  for (const item of payloads) {
    const payload = JSON.stringify(item);
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
