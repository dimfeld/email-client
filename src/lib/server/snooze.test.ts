import { afterEach, expect, test } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { createDatabase, listEmails, upsertAccount, upsertEmails } from './db';
import type { googleApiRequest } from './google-api';
import { listMail } from './mail-list';
import { cancelSnooze, snoozeThread, wakeDueSnoozes } from './snooze';

let database: DatabaseSync | undefined;
afterEach(() => {
  database?.close();
  database = undefined;
});

const account = { email: 'one@example.com', refreshToken: 'token' };
const succeed = (async () => ({})) as typeof googleApiRequest;

function setup() {
  database = createDatabase(':memory:');
  upsertAccount(database, account);
  upsertEmails(database, account.email, [
    { id: 'first', threadId: 'thread', labels: ['INBOX'] },
    { id: 'second', threadId: 'thread', labels: ['INBOX'] },
  ]);
  return Number(database.prepare("SELECT id FROM emails WHERE gmail_id = 'first'").get()!.id);
}
const inboxIds = () =>
  listEmails(database!)
    .filter((email) => email.labels.includes('INBOX'))
    .map((email) => email.gmailId)
    .sort();
const snoozeRows = () =>
  database!.prepare('SELECT wake_at, retry_count, error FROM snoozes').all() as {
    wake_at: number;
    retry_count: number;
    error: string | null;
  }[];

test('archives a snoozed thread and returns it to the inbox when the snooze ends', async () => {
  const id = setup();
  const result = await snoozeThread(database!, account, id, 1_000, succeed);
  expect(result.succeededIds).toHaveLength(2);
  expect(inboxIds()).toEqual([]);

  await wakeDueSnoozes(database!, 999, succeed);
  expect(inboxIds()).toEqual([]);
  await wakeDueSnoozes(database!, 1_000, succeed);
  expect(inboxIds()).toEqual(['first', 'second']);
  expect(listEmails(database!).filter((email) => email.labels.includes('STARRED'))).toHaveLength(1);
  expect(snoozeRows()).toEqual([]);
});

test('lists snoozed threads by the time their snooze ends', async () => {
  const id = setup();
  upsertEmails(database!, account.email, [{ id: 'other', threadId: 'other', labels: ['INBOX'] }]);
  const otherId = Number(
    database!.prepare("SELECT id FROM emails WHERE gmail_id = 'other'").get()!.id
  );
  await snoozeThread(database!, account, id, 2_000, succeed);
  await snoozeThread(database!, account, otherId, 1_000, succeed);
  const list = listMail(database!, { view: 'snoozed', search: '', filter: 'all', limit: 10 });
  expect(list.emails.map((email) => email.snoozedUntil)).toEqual([1_000, 2_000]);
  expect(listMail(database!, { search: '', filter: 'all', limit: 10 }).emails).toEqual([]);
});

test('retries the star when Gmail rejects it after the thread returns', async () => {
  const id = setup();
  await snoozeThread(database!, account, id, 1_000, succeed);
  const rejectStar = (async (_account: unknown, _url: string, options?: { data?: unknown }) => {
    if (JSON.stringify(options?.data).includes('STARRED')) throw new Error('Star failed');
    return {};
  }) as typeof googleApiRequest;
  await wakeDueSnoozes(database!, 1_000, rejectStar);
  expect(snoozeRows()).toEqual([{ wake_at: 2_000, retry_count: 1, error: 'Star failed' }]);
  await wakeDueSnoozes(database!, 2_000, succeed);
  expect(snoozeRows()).toEqual([]);
  expect(listEmails(database!).filter((email) => email.labels.includes('STARRED'))).toHaveLength(1);
});

test('undo returns the thread at once and removes the snooze', async () => {
  const id = setup();
  const result = await snoozeThread(database!, account, id, 1_000, succeed);
  await cancelSnooze(database!, account, id, result.succeededIds, succeed);
  expect(inboxIds()).toEqual(['first', 'second']);
  expect(snoozeRows()).toEqual([]);
});

test('retries a failed wake later with backoff', async () => {
  const id = setup();
  await snoozeThread(database!, account, id, 1_000, succeed);
  await wakeDueSnoozes(database!, 5_000, (async () => {
    throw new Error('Gmail unavailable');
  }) as typeof googleApiRequest);
  expect(snoozeRows()).toEqual([{ wake_at: 6_000, retry_count: 1, error: 'Gmail unavailable' }]);
  expect(inboxIds()).toEqual([]);

  await wakeDueSnoozes(database!, 6_000, succeed);
  expect(inboxIds()).toEqual(['first', 'second']);
  expect(snoozeRows()).toEqual([]);
});
