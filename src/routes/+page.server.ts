import { fail, type RequestEvent } from '@sveltejs/kit';
import { applyGmailMessageAction } from '$lib/server/gmail-actions';
import { getDatabase, getEmailActionTarget, listAccounts, listCategories, listEmails } from '$lib/server/db';
import type { GmailMessageAction } from '$lib/server/gmail-actions';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, depends }) => {
	depends('app:state');
	const database = getDatabase();
	const requestedAccount = url.searchParams.get('account');
	const accounts = listAccounts(database);
	const selectedAccount = accounts.some((account) => account.email === requestedAccount)
		? requestedAccount
		: null;
	return {
		accounts,
		categories: listCategories(database),
		selectedAccount,
		emails: listEmails(database, selectedAccount ?? undefined)
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
