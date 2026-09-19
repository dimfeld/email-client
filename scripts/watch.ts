import { getDatabase, listAccounts } from '../src/lib/server/db';

const accounts = listAccounts(getDatabase()).filter(
	(account) => account.enabled && account.subscription
);
if (accounts.length === 0) {
	throw new Error('No enabled account has a Pub/Sub subscription. Run account:configure first.');
}

const hookUrl = `${process.env.APP_URL ?? 'http://127.0.0.1:3000'}/api/hooks/gmail`;
const children = accounts.map((account) => {
	const command = [
		'gog',
		'gmail',
		'watch',
		'pull',
		'--account',
		account.email,
		'--client',
		account.client,
		'--subscription',
		account.subscription!,
		'--hook-url',
		hookUrl,
		'--include-body',
		'--history-types',
		'messageAdded,messageDeleted'
	];
	if (process.env.GMAIL_HOOK_TOKEN) command.push('--hook-token', process.env.GMAIL_HOOK_TOKEN);
	console.log(`Starting Gmail watch for ${account.email}.`);
	return Bun.spawn(command, { stdout: 'inherit', stderr: 'inherit' });
});

function stop(): void {
	for (const child of children) child.kill();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const exitCodes = await Promise.all(children.map((child) => child.exited));
process.exitCode = exitCodes.find((code) => code !== 0) ?? 0;
