import { getDatabase, listAccounts } from '../src/lib/server/db';

const port = process.env.PORT ?? '3000';
const server = Bun.spawn(['bun', 'build/index.js'], {
	env: { ...process.env, PORT: port },
	stdout: 'inherit',
	stderr: 'inherit'
});
const hasWatchers = listAccounts(getDatabase()).some(
	(account) => account.enabled && account.subscription
);
const watcher = hasWatchers
	? Bun.spawn(['bun', 'scripts/watch.ts'], {
			env: { ...process.env, APP_URL: process.env.APP_URL ?? `http://127.0.0.1:${port}` },
			stdout: 'inherit',
			stderr: 'inherit'
		})
	: null;

if (!watcher) {
	console.log('No Pub/Sub subscriptions are configured. The web server will run without watchers.');
}

function stop(): void {
	server.kill();
	watcher?.kill();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const processes = [server.exited.then((code) => ({ name: 'server', code }))];
if (watcher) processes.push(watcher.exited.then((code) => ({ name: 'watcher', code })));
const winner = await Promise.race(processes);
stop();
console.error(`${winner.name} stopped with exit code ${winner.code}.`);
process.exitCode = winner.code;
