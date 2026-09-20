import type { DatabaseSync } from 'node:sqlite';
import { markArchived, markDeleted } from './db';
import { runGogJson } from './gog';

export type GmailMessageAction = 'archive' | 'delete';

export type GmailActionAccount = {
	email: string;
	client: string;
};

export async function runGmailMessageAction(
	account: GmailActionAccount,
	gmailId: string,
	action: GmailMessageAction,
	runJson: typeof runGogJson = runGogJson
): Promise<void> {
	await runJson([
		'gog',
		'gmail',
		action === 'archive' ? 'archive' : 'trash',
		gmailId,
		'--account',
		account.email,
		'--client',
		account.client,
		'--json',
		'--no-input',
		'--force'
	]);
}

export async function applyGmailMessageAction(
	database: DatabaseSync,
	account: GmailActionAccount,
	gmailId: string,
	action: GmailMessageAction,
	runJson: typeof runGogJson = runGogJson
): Promise<void> {
	await runGmailMessageAction(account, gmailId, action, runJson);
	if (action === 'archive') markArchived(database, account.email, [gmailId]);
	else markDeleted(database, account.email, [gmailId]);
}
