import { describe, expect, it } from 'bun:test';
import { createDatabase, listAccounts, listContacts, upsertAccount } from './db';
import type { GoogleAccount } from './google-api';
import { syncGoogleData } from './google-auto-sync';

describe('automatic Google data sync', () => {
  it('syncs enabled connected accounts and isolates account failures', async () => {
    const database = createDatabase(':memory:');
    upsertAccount(database, { email: 'good@example.com', refreshToken: 'good-token' });
    upsertAccount(database, { email: 'bad@example.com', refreshToken: 'bad-token' });
    upsertAccount(database, { email: 'disconnected@example.com' });
    const request = async <T>(account: GoogleAccount, url: string): Promise<T> => {
      if (account.email === 'bad@example.com') throw new Error('Unavailable');
      if (url.endsWith('/people/me')) return { names: [{ displayName: 'Good Owner' }] } as T;
      if (url.includes('connections'))
        return {
          connections: [{ resourceName: 'people/one', names: [{ displayName: 'One' }] }],
          nextSyncToken: 'contacts-sync',
        } as T;
      return { items: [], nextSyncToken: 'calendar-list-sync' } as T;
    };

    const result = await syncGoogleData({ database, request, syncOptions: { pageDelayMs: 0 } });
    expect(result).toEqual({ accounts: 2, succeeded: 1, failed: 1, deferred: 0 });
    expect(listContacts(database).map((contact) => contact.accountEmail)).toEqual([
      'good@example.com',
    ]);
    expect(
      listAccounts(database).find((account) => account.email === 'good@example.com')?.displayName
    ).toBe('Good Owner');
    database.close();
  });
});
