import { fail } from '@sveltejs/kit';
import { getDatabase } from '$lib/server/db';
import { syncConfiguredGoogleAccounts } from '$lib/server/google-sync';
import { listSettingsAccounts } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ setHeaders, depends }) => {
  depends('app:accounts');
  setHeaders({ 'cache-control': 'no-store' });
  return { accounts: listSettingsAccounts(getDatabase()) };
};

export const actions: Actions = {
  syncGoogle: async ({ request }) => {
    const fields = await request.formData();
    const account = String(fields.get('account') ?? '');
    if (!account) return fail(400, { error: 'Choose an account to sync.' });
    try {
      const [{ result }] = await syncConfiguredGoogleAccounts(getDatabase(), account);
      return {
        message: result.deferred
          ? `Google rate limit reached. Saved progress for ${account}; the next sync will resume from the last completed page.`
          : `Fetched ${result.contacts} contacts, ${result.calendars} calendars, and ${result.events} events for ${account}.`,
      };
    } catch (error) {
      return fail(502, { error: error instanceof Error ? error.message : String(error) });
    }
  },
};
