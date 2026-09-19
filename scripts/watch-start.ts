import { getDatabase, listAccounts, setAccountHistoryId } from '../src/lib/server/db';
import { requireFlag, runJson } from './shared';

const email = requireFlag('--account');
const account = listAccounts(getDatabase()).find((candidate) => candidate.email === email);
if (!account) throw new Error(`Run accounts:discover before configuring ${email}.`);
if (!account.topic) throw new Error(`Configure a Pub/Sub topic for ${email} first.`);

const result = (await runJson([
		'gog',
		'gmail',
		'watch',
		'start',
		'--account',
		email,
		'--client',
		account.client,
		'--topic',
		account.topic,
		'--label',
		'INBOX',
		'--json',
		'--no-input'
	])) as { watch?: { historyId?: unknown }; historyId?: unknown };
const historyId = result.watch?.historyId ?? result.historyId;
if (typeof historyId !== 'string' || !/^\d+$/.test(historyId)) {
	throw new Error('gog watch start did not return a valid historyId.');
}

setAccountHistoryId(getDatabase(), email, historyId);
console.log(`Started Gmail watch for ${email} at history ID ${historyId}.`);
