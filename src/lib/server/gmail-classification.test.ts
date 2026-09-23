import { afterEach, expect, test } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { createDatabase, getIncomingEmail, upsertAccount, upsertEmails } from './db';
import { saveGmailClassification } from './gmail-classification';
import type { Classification } from './types';

let database: DatabaseSync | undefined;
afterEach(() => {
  database?.close();
  database = undefined;
});

const account = { email: 'owner@example.com', refreshToken: 'token' };
const classification: Classification = {
  category: 'action',
  importance: null,
  hasActionItem: false,
  actionItemProbability: 0,
  hasReminder: false,
  reminderProbability: 0,
  model: 'test',
  categoryConfidence: 1,
  importanceConfidence: null,
  categoryProbabilities: { action: 1 },
  importanceProbabilities: {},
};

test('stars an important category in Gmail and local mail once', async () => {
  database = createDatabase(':memory:');
  upsertAccount(database, account);
  upsertEmails(database, account.email, [{ id: 'message/1', labels: ['INBOX'] }]);
  const requests: unknown[] = [];
  const request = async <T>(_account: unknown, url: string, options?: unknown): Promise<T> => {
    requests.push({ url, options });
    return {} as T;
  };

  await saveGmailClassification(database, account, 'message/1', classification, request);
  await saveGmailClassification(database, account, 'message/1', classification, request);

  expect(requests).toEqual([
    {
      url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/message%2F1/modify',
      options: { method: 'POST', data: { addLabelIds: ['STARRED'] } },
    },
  ]);
  expect(getIncomingEmail(database, account.email, 'message/1')?.labels).toEqual([
    'INBOX',
    'STARRED',
  ]);
});

test('uses the chosen importance for automatic categories and keeps other stars', async () => {
  database = createDatabase(':memory:');
  upsertAccount(database, account);
  upsertEmails(database, account.email, [
    { id: 'important', labels: ['INBOX'] },
    { id: 'useful', labels: ['INBOX', 'STARRED'] },
  ]);
  const ids: string[] = [];
  const request = async <T>(_account: unknown, url: string): Promise<T> => {
    ids.push(url);
    return {} as T;
  };
  await saveGmailClassification(
    database,
    account,
    'important',
    { ...classification, category: 'personal', importance: 'important' },
    request
  );
  await saveGmailClassification(
    database,
    account,
    'useful',
    { ...classification, category: 'personal', importance: 'useful' },
    request
  );

  expect(ids).toHaveLength(1);
  expect(getIncomingEmail(database, account.email, 'important')?.labels).toContain('STARRED');
  expect(getIncomingEmail(database, account.email, 'useful')?.labels).toContain('STARRED');
});

test('keeps classification pending when Gmail rejects the star', async () => {
  database = createDatabase(':memory:');
  upsertAccount(database, account);
  upsertEmails(database, account.email, [{ id: 'message', labels: ['INBOX'] }]);
  await expect(
    saveGmailClassification(database, account, 'message', classification, async () => {
      throw new Error('Gmail unavailable');
    })
  ).rejects.toThrow('Gmail unavailable');
  expect(
    database.prepare('SELECT classified_at FROM emails WHERE gmail_id = ?').get('message')
  ).toMatchObject({ classified_at: null });
  expect(getIncomingEmail(database, account.email, 'message')?.labels).toEqual(['INBOX']);
});
