import { getDatabase, listAccounts, listCalendars, listCalendarEvents } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, depends, setHeaders }) => {
	depends('app:state');
	setHeaders({ 'cache-control': 'no-store' });
	const database = getDatabase();
	const accounts = listAccounts(database);
	const requestedAccount = url.searchParams.get('account');
	const selectedAccount = accounts.some((account) => account.email === requestedAccount) ? requestedAccount : null;
	return {
		accounts,
		selectedAccount,
		calendars: listCalendars(database, selectedAccount ?? undefined),
		events: listCalendarEvents(database, selectedAccount ?? undefined)
	};
};
