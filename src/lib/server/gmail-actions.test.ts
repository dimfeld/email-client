import { afterEach, describe, expect, it } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { createDatabase, listEmails, upsertAccount, upsertEmails } from './db';
import {
  applyGmailMessageAction,
  applyGmailThreadAction,
  runGmailMessageAction,
} from './gmail-actions';
import type { GoogleAccount } from './google-api';

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe('Gmail message actions', () => {
  it('archives a message with the Gmail modify endpoint', async () => {
    let request: { url: string; options: unknown } | undefined;
    await runGmailMessageAction(
      { email: 'one@example.com', refreshToken: 'token' },
      'gmail-message',
      'archive',
      async <T>(
        _account: GoogleAccount,
        url: string,
        options?: {
          method?: string;
          params?: Record<string, string | number | boolean | undefined>;
          data?: unknown;
        }
      ) => {
        request = { url, options };
        return {} as T;
      }
    );
    expect(request).toEqual({
      url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/gmail-message/modify',
      options: { method: 'POST', data: { removeLabelIds: ['INBOX'] } },
    });
  });

  it('moves a message to Gmail Trash for delete', async () => {
    let url = '';
    await runGmailMessageAction(
      { email: 'one@example.com', refreshToken: 'token' },
      'gmail-message',
      'delete',
      async <T>(_account: GoogleAccount, value: string) => {
        url = value;
        return {} as T;
      }
    );
    expect(url).toEndWith('/messages/gmail-message/trash');
  });

  it('updates local state only after Gmail succeeds and keeps archived mail recoverable', async () => {
    database = createDatabase(':memory:');
    upsertAccount(database, { email: 'one@example.com' });
    const message = { id: 'gmail-message', subject: 'A message', labels: ['INBOX'] };
    upsertEmails(database, 'one@example.com', [message]);

    await applyGmailMessageAction(
      database,
      { email: 'one@example.com', refreshToken: 'token' },
      message.id,
      'archive',
      async <T>() => ({}) as T
    );
    expect(listEmails(database)).toHaveLength(0);
    expect(
      database
        .prepare('SELECT labels_json, deleted_at FROM emails WHERE gmail_id = ?')
        .get(message.id)
    ).toMatchObject({ labels_json: '[]', deleted_at: null });

    upsertEmails(database, 'one@example.com', [message]);
    expect(listEmails(database)).toHaveLength(1);
  });

  it('reverses archive and delete with the Gmail modify and untrash endpoints', async () => {
    const requests: { url: string; options: unknown }[] = [];
    const request = async <T>(_account: GoogleAccount, url: string, options?: unknown) => {
      requests.push({ url, options });
      return {} as T;
    };
    const account = { email: 'one@example.com', refreshToken: 'token' };
    await runGmailMessageAction(account, 'gmail-message', 'unarchive', request);
    await runGmailMessageAction(account, 'gmail-message', 'undelete', request);
    expect(requests).toEqual([
      {
        url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/gmail-message/modify',
        options: { method: 'POST', data: { addLabelIds: ['INBOX'] } },
      },
      {
        url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/gmail-message/untrash',
        options: { method: 'POST', data: undefined },
      },
    ]);
  });

  it('shows a message again locally after undo', async () => {
    database = createDatabase(':memory:');
    upsertAccount(database, { email: 'one@example.com' });
    upsertEmails(database, 'one@example.com', [
      { id: 'gmail-message', subject: 'A message', labels: ['INBOX'] },
    ]);
    const account = { email: 'one@example.com', refreshToken: 'token' };
    const request = async <T>() => ({}) as T;

    await applyGmailMessageAction(database, account, 'gmail-message', 'archive', request);
    await applyGmailMessageAction(database, account, 'gmail-message', 'unarchive', request);
    expect(listEmails(database)).toHaveLength(1);

    await applyGmailMessageAction(database, account, 'gmail-message', 'delete', request);
    expect(listEmails(database)).toHaveLength(0);
    await applyGmailMessageAction(database, account, 'gmail-message', 'undelete', request);
    expect(listEmails(database)).toHaveLength(1);
  });

  it('marks a message as read in Gmail and removes the local UNREAD label', async () => {
    database = createDatabase(':memory:');
    upsertAccount(database, { email: 'one@example.com' });
    upsertEmails(database, 'one@example.com', [
      { id: 'gmail-message', subject: 'A message', labels: ['INBOX', 'UNREAD'] },
    ]);
    let request: { url: string; options: unknown } | undefined;
    await applyGmailMessageAction(
      database,
      { email: 'one@example.com', refreshToken: 'token' },
      'gmail-message',
      'markRead',
      async <T>(_account: GoogleAccount, url: string, options?: unknown) => {
        request = { url, options };
        return {} as T;
      }
    );
    expect(request).toEqual({
      url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/gmail-message/modify',
      options: { method: 'POST', data: { removeLabelIds: ['UNREAD'] } },
    });
    expect(listEmails(database)[0].labels).toEqual(['INBOX']);
  });

  it('does not hide a message when Gmail rejects the action', async () => {
    database = createDatabase(':memory:');
    upsertAccount(database, { email: 'one@example.com' });
    upsertEmails(database, 'one@example.com', [
      { id: 'gmail-message', subject: 'A message', labels: ['INBOX'] },
    ]);

    await expect(
      applyGmailMessageAction(
        database,
        { email: 'one@example.com', refreshToken: 'token' },
        'gmail-message',
        'delete',
        async () => {
          throw new Error('Gmail unavailable');
        }
      )
    ).rejects.toThrow('Gmail unavailable');
    expect(listEmails(database)).toHaveLength(1);
  });
});

it('keeps completed thread changes on a partial Gmail failure and undoes only those messages', async () => {
  database = createDatabase(':memory:');
  const account = { email: 'one@example.com', refreshToken: 'token' };
  upsertAccount(database, account);
  upsertEmails(database, account.email, [
    { id: 'first', threadId: 'thread', labels: ['INBOX'] },
    { id: 'second', threadId: 'thread', labels: ['INBOX'] },
    { id: 'sent', threadId: 'thread', labels: ['SENT'] },
  ]);
  const firstId = Number(
    database.prepare("SELECT id FROM emails WHERE gmail_id = 'first'").get()!.id
  );
  let requests = 0;
  const request = (async () => {
    requests += 1;
    if (requests === 2) throw new Error('Gmail failed');
    return {};
  }) as Parameters<typeof applyGmailThreadAction>[5];
  const result = await applyGmailThreadAction(
    database,
    account,
    firstId,
    'archive',
    undefined,
    request
  );
  expect(result).toEqual({ succeededIds: [firstId], total: 2, error: 'Gmail failed' });
  expect(listEmails(database).map((email) => email.gmailId)).toEqual(['second']);
  upsertEmails(database, account.email, [{ id: 'late', threadId: 'thread', labels: ['INBOX'] }]);
  await applyGmailThreadAction(
    database,
    account,
    firstId,
    'unarchive',
    result.succeededIds,
    (async () => ({})) as Parameters<typeof applyGmailThreadAction>[5]
  );
  expect(
    listEmails(database)
      .map((email) => email.gmailId)
      .sort()
  ).toEqual(['first', 'late', 'second']);
});

it('stars the latest thread message and unstars every starred message', async () => {
  database = createDatabase(':memory:');
  const account = { email: 'one@example.com', refreshToken: 'token' };
  upsertAccount(database, account);
  upsertEmails(database, account.email, [
    { id: 'old', threadId: 'thread', date: 'Mon, 5 Jan 2026 10:00:00 +0000', labels: ['INBOX'] },
    { id: 'new', threadId: 'thread', date: 'Tue, 6 Jan 2026 10:00:00 +0000', labels: ['INBOX'] },
  ]);
  const oldId = Number(database.prepare("SELECT id FROM emails WHERE gmail_id = 'old'").get()!.id);
  const urls: string[] = [];
  const request = (async (_account: GoogleAccount, url: string) => {
    urls.push(url);
    return {};
  }) as Parameters<typeof applyGmailThreadAction>[5];
  const starredIds = () =>
    listEmails(database!)
      .filter((email) => email.labels.includes('STARRED'))
      .map((email) => email.gmailId)
      .sort();

  await applyGmailThreadAction(database, account, oldId, 'star', undefined, request);
  expect(urls).toEqual(['https://gmail.googleapis.com/gmail/v1/users/me/messages/new/modify']);
  expect(starredIds()).toEqual(['new']);

  upsertEmails(database, account.email, [
    {
      id: 'old',
      threadId: 'thread',
      date: 'Mon, 5 Jan 2026 10:00:00 +0000',
      labels: ['INBOX', 'STARRED'],
    },
  ]);
  urls.length = 0;
  await applyGmailThreadAction(database, account, oldId, 'unstar', undefined, request);
  expect(urls).toHaveLength(2);
  expect(starredIds()).toEqual([]);
});
