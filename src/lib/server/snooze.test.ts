import { afterEach, expect, test } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { createDatabase, listEmails, upsertAccount, upsertEmails } from './db';
import type { googleApiRequest } from './google-api';
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
  expect(snoozeRows()).toEqual([]);
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
