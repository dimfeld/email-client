import { fail } from '@sveltejs/kit';
import {
  getDatabase,
  listAccounts,
  populateAccountDisplayName,
  setAccountDisplayName,
} from '$lib/server/db';
import { fetchGoogleAccountName } from '$lib/server/google-api';
import { listSettingsAccounts } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ setHeaders, depends }) => {
  depends('app:accounts');
  setHeaders({ 'cache-control': 'no-store' });
  const database = getDatabase();
  await Promise.all(
    listAccounts(database)
      .filter((account) => account.refreshToken && account.displayName === null)
      .map(async (account) => {
        try {
          const name = await fetchGoogleAccountName(account);
          if (name) populateAccountDisplayName(database, account.email, name);
        } catch {
          // Existing OAuth grants might not allow access to the profile.
        }
      })
  );
  return { accounts: listSettingsAccounts(database) };
};

export const actions: Actions = {
  saveAccountName: async ({ request }) => {
    const fields = await request.formData();
    try {
      setAccountDisplayName(
        getDatabase(),
        String(fields.get('account') ?? ''),
        String(fields.get('displayName') ?? '')
      );
      return { message: 'Account name saved. New classifications will use it.' };
    } catch (error) {
      return fail(400, {
        error: error instanceof Error ? error.message : 'Could not save the name.',
      });
    }
  },
};
