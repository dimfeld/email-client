import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import type { EmailClassifier } from './classifier';
import { createDatabase, listAccounts, listEmails, upsertAccount, upsertEmails } from './db';
import { pollGmailHistory } from './gmail-history-poll';

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

const classify: EmailClassifier = async () => ({
  category: 'action',
  importance: 'useful',
  hasActionItem: true,
  actionItemProbability: 1,
  hasReminder: false,
  reminderProbability: 0,
  model: 'test',
  categoryConfidence: 1,
  importanceConfidence: 1,
  categoryProbabilities: { action: 1 },
  importanceProbabilities: { useful: 1 },
});

describe('Gmail history polling', () => {
  it('starts from the current profile when an account has no history cursor', async () => {
    database = createDatabase(':memory:');
    upsertAccount(database, { email: 'one@example.com', refreshToken: 'token' });
    const urls: string[] = [];
    const info = spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      await pollGmailHistory({
        database,
        classify,
        request: async <T>(_account: unknown, url: string) => {
          urls.push(url);
          return { historyId: '105' } as T;
        },
      });
    } finally {
      info.mockRestore();
    }
    expect(urls).toEqual(['https://gmail.googleapis.com/gmail/v1/users/me/profile']);
    expect(listAccounts(database)[0].historyId).toBe('105');
  });

  it('applies missed archive and Trash changes without a Pub/Sub notification', async () => {
    database = createDatabase(':memory:');
    upsertAccount(database, { email: 'one@example.com', refreshToken: 'token' });
    database.prepare('UPDATE accounts SET history_id = ?').run('100');
    upsertEmails(database, 'one@example.com', [
      { id: 'archived', subject: 'Archived', labels: ['INBOX'] },
      { id: 'trashed', subject: 'Trashed', labels: ['INBOX'] },
    ]);
    const info = spyOn(console, 'info').mockImplementation(() => undefined);
    const requests: string[] = [];
    try {
      await pollGmailHistory({
        database,
        classify,
        request: async <T>(_account: unknown, url: string) => {
          requests.push(url);
          return (
            url.endsWith('/profile')
              ? { historyId: '105' }
              : {
                  historyId: '105',
                  history: [
                    { labelsRemoved: [{ message: { id: 'archived' }, labelIds: ['INBOX'] }] },
                    { labelsAdded: [{ message: { id: 'trashed' }, labelIds: ['TRASH'] }] },
                  ],
                }
          ) as T;
        },
        getMessage: async (_account, id) => ({
          id,
          labels: id === 'archived' ? [] : ['TRASH'],
        }),
      });
      expect(info).toHaveBeenCalledWith(
        'Gmail history poll completed.',
        expect.objectContaining({ account: 'one@example.com', archived: 1, deleted: 1 })
      );
    } finally {
      info.mockRestore();
    }

    expect(requests).toEqual([
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      'https://gmail.googleapis.com/gmail/v1/users/me/history',
    ]);
    expect(listEmails(database)).toEqual([]);
    expect(listAccounts(database)[0].historyId).toBe('105');
  });

  it('keeps the history cursor when a request fails', async () => {
    database = createDatabase(':memory:');
    upsertAccount(database, { email: 'one@example.com', refreshToken: 'token' });
    database.prepare('UPDATE accounts SET history_id = ?').run('100');
    const errorLog = spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await pollGmailHistory({
        database,
        classify,
        request: async <T>(_account: unknown, url: string) => {
          if (url.endsWith('/profile')) return { historyId: '105' } as T;
          throw new Error('History unavailable');
        },
      });
      expect(errorLog).toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
    expect(listAccounts(database)[0].historyId).toBe('100');
  });
});
