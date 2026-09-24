import { getDatabase, listAccounts } from '$lib/server/db';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ depends }) => {
  depends('app:accounts');
  return {
    settingsAccounts: listAccounts(getDatabase()).map(({ email, alias }) => ({ email, alias })),
  };
};
