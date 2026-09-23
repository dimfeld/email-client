import { getDatabase, listAccounts, listContacts } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, depends, setHeaders }) => {
  depends('app:contacts', 'app:accounts');
  setHeaders({ 'cache-control': 'no-store' });
  const database = getDatabase();
  const accounts = listAccounts(database);
  const requestedAccount = url.searchParams.get('account');
  const selectedAccount = accounts.some((account) => account.email === requestedAccount)
    ? requestedAccount
    : null;
  return {
    accounts: accounts.map(({ refreshToken, ...account }) => account),
    selectedAccount,
    contacts: listContacts(database, selectedAccount ?? undefined),
  };
};
