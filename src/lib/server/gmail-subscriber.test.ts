import { afterEach, describe, expect, it } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import type { EmailClassifier } from './classifier';
import { createDatabase, listAccounts, listEmails, upsertAccount, upsertEmails } from './db';
import {
  groupAccountsBySubscription,
  parseGmailNotification,
  processGmailNotification,
  type GmailSubscriberAccount,
} from './gmail-subscriber';

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

describe('Gmail Pub/Sub routing', () => {
  it('uses one subscription group for accounts that share a subscription', () => {
    const accounts: GmailSubscriberAccount[] = [
      {
        email: 'one@example.com',
        refreshToken: 'one',
        subscription: 'projects/p/subscriptions/mail',
        historyId: '10',
      },
      {
        email: 'two@example.com',
        refreshToken: 'two',
        subscription: 'projects/p/subscriptions/mail',
        historyId: '20',
      },
    ];

    const groups = groupAccountsBySubscription(accounts);

    expect(groups.size).toBe(1);
    expect(groups.get('projects/p/subscriptions/mail')?.get('two@example.com')?.refreshToken).toBe(
      'two'
    );
  });

  it('parses the Gmail account and history ID from Pub/Sub data', () => {
    const data = Buffer.from(
      JSON.stringify({ emailAddress: 'One@Example.com', historyId: '123456' })
    );
    expect(parseGmailNotification(data)).toEqual({
      emailAddress: 'One@Example.com',
      historyId: '123456',
    });
    expect(
      parseGmailNotification(
        Buffer.from(
          JSON.stringify({ emailAddress: 'daniel@danielimfeld.com', historyId: 28086859 })
        )
      )
    ).toEqual({ emailAddress: 'daniel@danielimfeld.com', historyId: '28086859' });
    expect(() => parseGmailNotification(Buffer.from('{}'))).toThrow('emailAddress');
  });
});

describe('Gmail notification processing', () => {
  it('fetches inbox messages with Google APIs and advances only the matching account cursor', async () => {
    database = createDatabase(':memory:');
    upsertAccount(database, {
      email: 'one@example.com',
      refreshToken: 'one',
      subscription: 'projects/p/subscriptions/mail',
    });
    upsertAccount(database, {
      email: 'two@example.com',
      refreshToken: 'two',
      subscription: 'projects/p/subscriptions/mail',
    });
    const account: GmailSubscriberAccount = {
      email: 'one@example.com',
      refreshToken: 'one',
      subscription: 'projects/p/subscriptions/mail',
      historyId: '100',
    };
    const urls: string[] = [];
    const request = async <T>(_account: unknown, url: string): Promise<T> => {
      urls.push(url);
      return {
        historyId: '105',
        history: [{ messages: [{ id: 'inbox-message' }, { id: 'sent-message' }] }],
      } as T;
    };
    const getMessage = async (_account: unknown, messageId: string) => ({
      id: messageId,
      subject: messageId,
      bodyText: `${messageId} body`,
      labels: messageId === 'inbox-message' ? ['INBOX'] : ['SENT'],
    });

    const result = await processGmailNotification(
      account,
      { emailAddress: 'one@example.com', historyId: '105' },
      { database, classify, request, getMessage }
    );

    expect(result.stored).toBe(2);
    expect(listEmails(database).map((email) => email.gmailId)).toEqual(['inbox-message']);
    expect(listAccounts(database).find((item) => item.email === 'one@example.com')?.historyId).toBe(
      '105'
    );
    expect(
      listAccounts(database).find((item) => item.email === 'two@example.com')?.historyId
    ).toBeNull();
    expect(urls[0]).toEndWith('/history');
  });

  it('bootstraps an existing watch cursor and ignores its immediate notification', async () => {
    database = createDatabase(':memory:');
    upsertAccount(database, {
      email: 'one@example.com',
      refreshToken: 'one',
      subscription: 'projects/p/subscriptions/mail',
    });
    const account: GmailSubscriberAccount = {
      email: 'one@example.com',
      refreshToken: 'one',
      subscription: 'projects/p/subscriptions/mail',
      historyId: null,
    };
    let calls = 0;

    const result = await processGmailNotification(
      account,
      { emailAddress: 'one@example.com', historyId: '100' },
      {
        database,
        classify,
        request: async <T>() => {
          calls += 1;
          return { historyId: '100' } as T;
        },
      }
    );

    expect(result).toEqual({ stored: 0, classified: 0, extracted: 0, deleted: 0, archived: 0 });
    expect(calls).toBe(1);
    expect(account.historyId).toBe('100');
    expect(listAccounts(database)[0].historyId).toBe('100');
  });

  it('applies archive and Trash changes to stored messages', async () => {
    database = createDatabase(':memory:');
    upsertAccount(database, { email: 'one@example.com', refreshToken: 'one' });
    upsertEmails(database, 'one@example.com', [
      { id: 'archived', subject: 'Archived', labels: ['INBOX'] },
      { id: 'trashed', subject: 'Trashed', labels: ['INBOX'] },
    ]);
    const account: GmailSubscriberAccount = {
      email: 'one@example.com',
      refreshToken: 'one',
      subscription: 'mail',
      historyId: '100',
    };

    const result = await processGmailNotification(
      account,
      { emailAddress: account.email, historyId: '105' },
      {
        database,
        classify,
        request: async <T>() =>
          ({
            historyId: '105',
            history: [
              { labelsRemoved: [{ message: { id: 'archived' }, labelIds: ['INBOX'] }] },
              { labelsAdded: [{ message: { id: 'trashed' }, labelIds: ['TRASH'] }] },
            ],
          }) as T,
        getMessage: async (_account, id) => ({
          id,
          labels: id === 'archived' ? [] : ['TRASH'],
        }),
      }
    );

    expect(result).toMatchObject({ stored: 1, archived: 1, deleted: 1 });
    expect(listEmails(database)).toEqual([]);
    expect(
      database
        .prepare('SELECT labels_json, deleted_at FROM emails WHERE gmail_id = ?')
        .get('archived')
    ).toMatchObject({ labels_json: '[]', deleted_at: null });
    expect(
      database.prepare('SELECT deleted_at FROM emails WHERE gmail_id = ?').get('trashed')
    ).toMatchObject({ deleted_at: expect.any(String) });
    expect(account.historyId).toBe('105');
  });
});
