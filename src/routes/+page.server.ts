import { fail, type RequestEvent } from '@sveltejs/kit';
import { applyGmailMessageAction } from '$lib/server/gmail-actions';
import { getDatabase, getEmail, getEmailActionTarget, listAccounts, listCategories, listEmails, listCalendarEventsBetween } from '$lib/server/db';
import type { GmailMessageAction } from '$lib/server/gmail-actions';
import { addDays, dateKeyFromDate, isDateKey } from '$lib/calendar';
import { searchEmails, SearchQueryError } from '$lib/server/email-search';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, depends }) => {
	depends('app:state');
	const database = getDatabase();
	const requestedAccount = url.searchParams.get('account');
	const accounts = listAccounts(database);
	const selectedAccount = accounts.some((account) => account.email === requestedAccount)
		? requestedAccount
		: null;
	const query = url.searchParams.get('q')?.trim() ?? '';
	let searchError: string | null = null;
	let emails: ReturnType<typeof listEmails>;
	try { emails = query ? searchEmails(database, query, selectedAccount ?? undefined) : listEmails(database, selectedAccount ?? undefined); }
	catch (error) {
		if (!(error instanceof SearchQueryError)) throw error;
		searchError = error.message; emails = [];
	}
	const requestedDay = url.searchParams.get('day');
	const calendarDay = isDateKey(requestedDay) ? requestedDay : dateKeyFromDate(new Date());
	return {
		calendarDay,
		query, searchError,
		selectedMessage: getEmail(database, Number(url.searchParams.get('message')), selectedAccount ?? undefined),
		accounts: accounts.map(({ refreshToken, ...account }) => ({ ...account, connected: Boolean(refreshToken) })),
		categories: listCategories(database),
		calendarEvents: listCalendarEventsBetween(database, calendarDay, addDays(calendarDay, 1)).filter((event) => !selectedAccount || event.accountEmail === selectedAccount),
		selectedAccount,
		emails
	};
};

async function changeMessage({ request }: RequestEvent, action: GmailMessageAction) {
	const fields = await request.formData();
	const emailId = Number(fields.get('id'));
	if (!Number.isInteger(emailId) || emailId <= 0) return fail(400, { error: 'The message ID is invalid.' });

	const database = getDatabase();
	const target = getEmailActionTarget(database, emailId);
	if (!target) return fail(404, { error: 'The message is no longer available.' });
	const account = listAccounts(database).find((item) => item.email === target.accountEmail);
	if (!account) return fail(404, { error: 'The email account is no longer available.' });

	try {
		await applyGmailMessageAction(database, account, target.gmailId, action);
		return { message: action === 'archive' ? 'Message archived.' : 'Message moved to Gmail Trash.' };
	} catch (error) {
		return fail(502, { error: error instanceof Error ? error.message : String(error) });
	}
}

export const actions: Actions = {
	archive: (event) => changeMessage(event, 'archive'),
	delete: (event) => changeMessage(event, 'delete')
};
