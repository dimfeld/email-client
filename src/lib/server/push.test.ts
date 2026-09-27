import { afterEach, describe, expect, it } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { WebPushError } from 'web-push';
import { createDatabase, listPushSubscriptions, savePushSubscription, upsertEmails } from './db';
import { sendEmailPushNotifications, shouldNotify } from './push';

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

const subscription = (endpoint: string) => ({ endpoint, keys: { p256dh: 'key', auth: 'auth' } });

describe('email push notifications', () => {
  it('notifies only for unread inbox mail that is important or useful', () => {
    const unread = { id: 'a', labels: ['INBOX', 'UNREAD'] };
    expect(shouldNotify(unread, 'important')).toBe(true);
    expect(shouldNotify(unread, 'useful')).toBe(true);
    expect(shouldNotify(unread, 'other')).toBe(false);
    expect(shouldNotify({ id: 'b', labels: ['INBOX'] }, 'important')).toBe(false);
    expect(shouldNotify({ id: 'c', labels: ['UNREAD'] }, 'important')).toBe(false);
  });

  it('sends a payload that opens the message and removes expired subscriptions', async () => {
    database = createDatabase(':memory:');
    const email = {
      id: 'gmail-1',
      threadId: 'thread-1',
      from: '"Ada Lovelace" <ada@example.com>',
      subject: 'Engine notes',
      labels: ['INBOX', 'UNREAD'],
    };
    upsertEmails(database, 'me@example.com', [email]);
    const rowId = (database.prepare('SELECT id FROM emails').get() as { id: number }).id;
    savePushSubscription(database, subscription('https://push.example/live'));
    savePushSubscription(database, subscription('https://push.example/gone'));

    const sent: Array<{ endpoint: string; payload: unknown }> = [];
    await sendEmailPushNotifications(
      database,
      'me@example.com',
      [email],
      async (target, payload) => {
        if (target.endpoint.endsWith('/gone'))
          throw new WebPushError('Gone', 410, {}, '', target.endpoint);
        sent.push({ endpoint: target.endpoint, payload: JSON.parse(payload) });
      }
    );

    expect(sent).toEqual([
      {
        endpoint: 'https://push.example/live',
        payload: {
          title: 'Ada Lovelace',
          body: 'Engine notes',
          url: `/?message=${rowId}`,
          tag: 'thread-1',
        },
      },
    ]);
    expect(listPushSubscriptions(database).map((item) => item.endpoint)).toEqual([
      'https://push.example/live',
    ]);
  });
});
