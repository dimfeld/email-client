import { fail } from '@sveltejs/kit';
import { getDatabase, setAccountAlias } from '$lib/server/db';
import { listSettingsAccounts } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ setHeaders, depends }) => {
  depends('app:accounts');
  setHeaders({ 'cache-control': 'no-store' });
  return { accounts: listSettingsAccounts(getDatabase()) };
};

export const actions: Actions = {
  saveAccountAlias: async ({ request }) => {
    const fields = await request.formData();
    try {
      setAccountAlias(
        getDatabase(),
        String(fields.get('account') ?? ''),
        String(fields.get('alias') ?? '')
      );
      return { message: 'Account label saved.' };
    } catch (error) {
      return fail(400, {
        error: error instanceof Error ? error.message : 'Could not save the label.',
      });
    }
  },
};
