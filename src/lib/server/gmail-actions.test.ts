import { afterEach, describe, expect, it } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { createDatabase, listEmails, upsertAccount, upsertEmails } from './db';
import { applyGmailMessageAction, runGmailMessageAction } from './gmail-actions';
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
        .prepare('SELECT archived_at, deleted_at FROM emails WHERE gmail_id = ?')
        .get(message.id)
    ).toMatchObject({ archived_at: expect.any(String), deleted_at: null });

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
    upsertEmails(database, 'one@example.com', [{ id: 'gmail-message', subject: 'A message' }]);
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
    upsertEmails(database, 'one@example.com', [{ id: 'gmail-message', subject: 'A message' }]);

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
