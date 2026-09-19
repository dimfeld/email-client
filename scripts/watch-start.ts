import { getDatabase, listAccounts } from '../src/lib/server/db';
import { requireFlag } from './shared';

const email = requireFlag('--account');
const account = listAccounts(getDatabase()).find((candidate) => candidate.email === email);
if (!account) throw new Error(`Run accounts:discover before configuring ${email}.`);
if (!account.topic) throw new Error(`Configure a Pub/Sub topic for ${email} first.`);

const child = Bun.spawn(
	[
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
		'INBOX'
	],
	{ stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' }
);

process.exitCode = await child.exited;
