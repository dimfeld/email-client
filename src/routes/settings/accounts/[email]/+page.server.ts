import { error, fail } from '@sveltejs/kit';
import {
  getDatabase,
  listAccounts,
  populateAccountDisplayName,
  setAccountAlias,
  setAccountDisplayName,
} from '$lib/server/db';
import { fetchGoogleAccountName } from '$lib/server/google-api';
import { syncConfiguredGoogleAccounts } from '$lib/server/google-sync';
import { listAccountStats, listSettingsAccounts } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, setHeaders, depends }) => {
  depends('app:accounts');
  setHeaders({ 'cache-control': 'no-store' });
  const database = getDatabase();
  const stored = listAccounts(database).find((account) => account.email === params.email);
  if (!stored) error(404, 'The Google account was not found.');
  if (stored.refreshToken && stored.displayName === null) {
    try {
      const name = await fetchGoogleAccountName(stored);
      if (name) populateAccountDisplayName(database, stored.email, name);
    } catch {
      // Existing OAuth grants might not allow access to the profile.
    }
  }
  return {
    account: listSettingsAccounts(database).find((account) => account.email === params.email)!,
    stats: listAccountStats(database).get(params.email)!,
  };
};

export const actions: Actions = {
  saveAccount: async ({ request, params }) => {
    const fields = await request.formData();
    try {
      const database = getDatabase();
      setAccountDisplayName(database, params.email, String(fields.get('displayName') ?? ''));
      setAccountAlias(database, params.email, String(fields.get('alias') ?? ''));
      return { message: 'Account settings saved.' };
    } catch (error) {
      return fail(400, {
        error: error instanceof Error ? error.message : 'Could not save the account settings.',
      });
    }
  },
  syncGoogle: async ({ params }) => {
    try {
      const [{ result }] = await syncConfiguredGoogleAccounts(getDatabase(), params.email);
      return {
        message: result.deferred
          ? 'Google rate limit reached. Saved progress; the next sync will resume from the last completed page.'
          : `Fetched ${result.contacts} contacts, ${result.calendars} calendars, and ${result.events} events.`,
      };
    } catch (error) {
      return fail(502, { error: error instanceof Error ? error.message : String(error) });
    }
  },
};
