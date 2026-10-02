import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import type { EmailClassifier } from './classifier';
import { createDatabase, listAccounts, listEmails, upsertAccount, upsertEmails } from './db';
import { pollGmailHistory } from './gmail-history-poll';
import { gmailHistoryQueue } from './gmail-history-queue';

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
  it('shares a pending notification sync instead of making another history request', async () => {
    database = createDatabase(':memory:');
    upsertAccount(database, { email: 'one@example.com', refreshToken: 'token' });
    database.prepare('UPDATE accounts SET history_id = ?').run('100');
    let requests = 0;
    const notification = gmailHistoryQueue.enqueue('one@example.com', '105', async (target) => {
      expect(target).toBe('105');
      database!.prepare('UPDATE accounts SET history_id = ?').run('105');
      return '105';
    });
    const poll = pollGmailHistory({
      database,
      classify,
      request: async <T>() => {
        requests += 1;
        return { historyId: '105' } as T;
      },
    });
    await Promise.all([notification, poll]);
    expect(requests).toBe(0);
    expect(listAccounts(database)[0].historyId).toBe('105');
  });

  it('continues polling other accounts while one account has a pending sync', async () => {
    database = createDatabase(':memory:');
    upsertAccount(database, { email: 'one@example.com', refreshToken: 'one' });
    upsertAccount(database, { email: 'two@example.com', refreshToken: 'two' });
    database.prepare('UPDATE accounts SET history_id = ?').run('100');
    let secondFinished!: () => void;
    const secondComplete = new Promise<void>((resolve) => {
      secondFinished = resolve;
    });
    const runningAccounts = new (class extends Set<string> {
      override delete(email: string): boolean {
        const deleted = super.delete(email);
        if (email === 'two@example.com') secondFinished();
        return deleted;
      }
    })();
    const requests: string[] = [];
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let started!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const info = spyOn(console, 'info').mockImplementation(() => undefined);
    const dependencies = {
      database,
      classify,
      request: async <T>(account: { email: string }) => {
        requests.push(account.email);
        if (account.email === 'one@example.com') {
          started();
          await pending;
        }
        return { historyId: '100' } as T;
      },
    };
    const first = pollGmailHistory(dependencies, runningAccounts);
    try {
      await firstStarted;
      await secondComplete;
      await pollGmailHistory(dependencies, runningAccounts);
      expect(requests).toEqual(['one@example.com', 'two@example.com', 'two@example.com']);
      expect(runningAccounts.has('one@example.com')).toBe(true);
    } finally {
      finish();
      await first;
      info.mockRestore();
    }
    expect(runningAccounts.size).toBe(0);
  });

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
        getMessage: async () => {
          throw new Error('Label changes must not download stored messages.');
        },
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
