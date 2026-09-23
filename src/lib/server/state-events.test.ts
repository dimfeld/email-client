import { afterEach, expect, it } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import {
  createDatabase,
  deleteCategory,
  markDeleted,
  saveCategory,
  saveClassification,
  saveClassificationError,
  setAccountHistoryId,
  upsertAccount,
  upsertEmails,
} from './db';
import { createStateEvents, publishStateChange } from './state-events';

let database: DatabaseSync | undefined;
let connections: AbortController[] = [];
afterEach(() => {
  for (const connection of connections) connection.abort();
  connections = [];
  database?.close();
  database = undefined;
});

function connect() {
  const abort = new AbortController();
  connections.push(abort);
  const response = createStateEvents(abort.signal);
  const reader = response.body!.getReader();
  const read = async () => new TextDecoder().decode((await reader.read()).value);
  return { abort, response, reader, read };
}

it('notifies clients for account, mail, classification, deletion, and category writes', async () => {
  database = createDatabase(':memory:');
  const { response, read } = connect();
  expect(response.headers.get('content-type')).toBe('text/event-stream');
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await read()).toBe('data: all\n\n');

  const writes: [() => void, string][] = [
    [() => upsertAccount(database!, { email: 'one@example.com' }), 'accounts'],
    [() => setAccountHistoryId(database!, 'one@example.com', '123'), 'accounts'],
    [
      () => upsertEmails(database!, 'one@example.com', [{ id: 'mail', subject: 'New mail' }]),
      'accounts,mail',
    ],
    [
      () =>
        saveClassification(database!, 'one@example.com', 'mail', {
          category: 'action',
          importance: null,
          model: 'test',
          categoryConfidence: 1,
          importanceConfidence: null,
          categoryProbabilities: { action: 1 },
          importanceProbabilities: {},
          hasActionItem: true,
          actionItemProbability: 1,
          hasReminder: false,
          reminderProbability: 0,
        }),
      'mail',
    ],
    [
      () => saveClassificationError(database!, 'one@example.com', 'mail', new Error('Retry')),
      'mail',
    ],
    [() => markDeleted(database!, 'one@example.com', ['mail']), 'mail'],
    [
      () =>
        saveCategory(database!, {
          id: 'action',
          name: 'Reply',
          description: 'Tasks.',
          level: 'important',
        }),
      'categories',
    ],
    [() => deleteCategory(database!, 'action'), 'categories'],
  ];
  for (const [write, scope] of writes) {
    write();
    expect(await read()).toBe(`data: ${scope}\n\n`);
  }
});

it('broadcasts to clients, cleans up closed streams, and refreshes after reconnect', async () => {
  const first = connect();
  const second = connect();
  await first.read();
  await second.read();
  publishStateChange();
  expect(await first.read()).toBe('data: all\n\n');
  expect(await second.read()).toBe('data: all\n\n');
  first.abort.abort();
  expect((await first.reader.read()).done).toBe(true);
  await second.reader.cancel();
  publishStateChange();
  const reconnected = connect();
  expect(await reconnected.read()).toBe('data: all\n\n');
  publishStateChange();
  expect(await reconnected.read()).toBe('data: all\n\n');
});

it('merges the scopes of changes in the same tick into one frame', async () => {
  const { read } = connect();
  await read();
  publishStateChange('mail');
  publishStateChange('drafts');
  publishStateChange('mail');
  expect(await read()).toBe('data: mail,drafts\n\n');
});

it('merges changes that arrive while a client has an unread frame into one later frame', async () => {
  const { read, reader, abort } = connect();
  publishStateChange('mail');
  await Promise.resolve();
  publishStateChange('drafts');
  await Promise.resolve();
  expect(await read()).toBe('data: all\n\n');
  expect(await read()).toBe('data: mail,drafts\n\n');
  abort.abort();
  expect((await reader.read()).done).toBe(true);
});
