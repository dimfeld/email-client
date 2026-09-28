import { afterEach, describe, expect, it } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { WebPushError } from 'web-push';
import { createDatabase, listPushSubscriptions, savePushSubscription, upsertEmails } from './db';
import { createDebouncedEmailNotifier, shouldNotify, type SendPush } from './push';

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
    const notify = createDebouncedEmailNotifier(5, async (target, payload) => {
      if (target.endpoint.endsWith('/gone'))
        throw new WebPushError('Gone', 410, {}, '', target.endpoint);
      sent.push({ endpoint: target.endpoint, payload: JSON.parse(payload) });
    });
    await notify(database, 'me@example.com', [email]);
    await Bun.sleep(30);

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

  describe('debouncing', () => {
    const email = (id: string, from: string) => ({
      id,
      threadId: `thread-${id}`,
      from,
      subject: `Subject ${id}`,
      labels: ['INBOX', 'UNREAD'],
    });

    function setup() {
      database = createDatabase(':memory:');
      savePushSubscription(database, subscription('https://push.example/live'));
      const sent: unknown[] = [];
      const send: SendPush = async (_target, payload) => {
        sent.push(JSON.parse(payload));
      };
      return { database, sent, notify: createDebouncedEmailNotifier(40, send) };
    }

    it('restarts the wait for each new email and sends one count notification', async () => {
      const { database, sent, notify } = setup();
      await notify(database, 'me@example.com', [email('a', 'Ada <ada@example.com>')]);
      await Bun.sleep(25);
      await notify(database, 'me@example.com', [email('b', 'Bob <bob@example.com>')]);
      await Bun.sleep(25);
      expect(sent).toEqual([]);
      await notify(database, 'me@example.com', [email('c', 'Ada <ada@example.com>')]);
      await Bun.sleep(80);
      expect(sent).toEqual([
        { title: 'New email', body: '3 new emails', url: '/', tag: 'new-emails' },
      ]);
    });

    it('uses the sender name when all emails come from one sender', async () => {
      const { database, sent, notify } = setup();
      await notify(database, 'me@example.com', [
        email('a', '"Ada Lovelace" <ada@example.com>'),
        email('b', '"Ada Lovelace" <ada@example.com>'),
      ]);
      await Bun.sleep(80);
      expect(sent).toEqual([
        { title: 'Ada Lovelace', body: '2 new emails', url: '/', tag: 'new-emails' },
      ]);
    });

    it('does not send when there are no emails', async () => {
      const { database, sent, notify } = setup();
      await notify(database, 'me@example.com', []);
      await Bun.sleep(80);
      expect(sent).toEqual([]);
    });
  });
});
