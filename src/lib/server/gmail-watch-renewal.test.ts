import { afterEach, describe, expect, it } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { createDatabase, listAccounts, upsertAccount } from './db';
import type { GoogleAccount } from './google-api';
import { renewGmailWatches } from './gmail-watch-renewal';

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe('Gmail watch renewal', () => {
  it('renews enabled watches and preserves an existing history cursor', async () => {
    database = createDatabase(':memory:');
    upsertAccount(database, {
      email: 'one@example.com',
      refreshToken: 'one',
      topic: 'projects/p/topics/mail',
      subscription: 'projects/p/subscriptions/mail',
    });
    upsertAccount(database, {
      email: 'two@example.com',
      refreshToken: 'two',
      topic: 'projects/p/topics/mail',
    });
    const requests: Array<{ email: string; url: string; data: unknown }> = [];
    const request = async <T>(
      account: { email: string },
      url: string,
      options?: { data?: unknown }
    ): Promise<T> => {
      requests.push({ email: account.email, url, data: options?.data });
      return { historyId: account.email === 'one@example.com' ? '200' : '300' } as T;
    };

    await expect(renewGmailWatches(database, request)).resolves.toEqual({ renewed: 2, failed: 0 });

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      email: 'one@example.com',
      url: 'https://gmail.googleapis.com/gmail/v1/users/me/watch',
      data: { topicName: 'projects/p/topics/mail' },
    });
    expect(listAccounts(database).map((account) => account.historyId)).toEqual(['200', '300']);
  });

  it('does not let one failed account prevent other watches from renewing', async () => {
    database = createDatabase(':memory:');
    upsertAccount(database, {
      email: 'failed@example.com',
      refreshToken: 'failed',
      topic: 'projects/p/topics/mail',
    });
    upsertAccount(database, {
      email: 'working@example.com',
      refreshToken: 'working',
      topic: 'projects/p/topics/mail',
    });

    await expect(
      renewGmailWatches(database, async <T>(account: GoogleAccount) => {
        if (account.email === 'failed@example.com') throw new Error('temporary Google failure');
        return { historyId: '400' } as T;
      })
    ).resolves.toEqual({ renewed: 1, failed: 1 });

    expect(
      listAccounts(database).find((account) => account.email === 'working@example.com')?.historyId
    ).toBe('400');
  });

  it('renews only the named account when an external token supplies its credentials', async () => {
    database = createDatabase(':memory:');
    upsertAccount(database, { email: 'one@example.com', topic: 'projects/p/topics/mail' });
    upsertAccount(database, {
      email: 'two@example.com',
      topic: 'projects/p/topics/mail',
      refreshToken: 'two',
    });
    const requested: string[] = [];

    const result = await renewGmailWatches(
      database,
      async <T>(account: GoogleAccount) => {
        requested.push(account.email);
        return { historyId: '500' } as T;
      },
      'one@example.com'
    );

    expect(result).toEqual({ renewed: 1, failed: 0 });
    expect(requested).toEqual(['one@example.com']);
    expect(listAccounts(database).map((account) => account.historyId)).toEqual(['500', null]);
  });
});
