import { fail, type RequestEvent } from '@sveltejs/kit';
import { applyGmailMessageAction } from '$lib/server/gmail-actions';
import { getDatabase, getEmailActionTarget, listAccounts } from '$lib/server/db';
import type { GmailMessageAction } from '$lib/server/gmail-actions';
import type { Actions } from './$types';

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
