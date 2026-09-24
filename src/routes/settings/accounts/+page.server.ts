import { getDatabase } from '$lib/server/db';
import { listAccountStats, listSettingsAccounts } from '$lib/server/settings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ setHeaders, depends }) => {
  depends('app:accounts');
  setHeaders({ 'cache-control': 'no-store' });
  const database = getDatabase();
  const stats = listAccountStats(database);
  return {
    accounts: listSettingsAccounts(database).map((account) => ({
      ...account,
      stats: stats.get(account.email)!,
    })),
  };
};
