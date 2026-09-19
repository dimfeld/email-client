import { getDatabase, listAccounts, listEmails } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const database = getDatabase();
	const requestedAccount = url.searchParams.get('account');
	const accounts = listAccounts(database);
	const selectedAccount = accounts.some((account) => account.email === requestedAccount)
		? requestedAccount
		: null;
	return {
		accounts,
		selectedAccount,
		emails: listEmails(database, selectedAccount ?? undefined)
	};
};
