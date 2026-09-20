import { afterEach, expect, it } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { createDatabase, deleteCategory, markDeleted, saveCategory, saveClassification, saveClassificationError, setAccountHistoryId, upsertAccount, upsertEmails } from './db';
import { createStateEvents, publishStateChange } from './state-events';

let database: DatabaseSync | undefined;
let connections: AbortController[] = [];
afterEach(() => {
	for (const connection of connections) connection.abort();
	connections = [];
	database?.close();
	database = undefined;
});

function connect() {
	const abort = new AbortController();
	connections.push(abort);
	const response = createStateEvents(abort.signal);
	const reader = response.body!.getReader();
	const read = async () => new TextDecoder().decode((await reader.read()).value);
	return { abort, response, reader, read };
}

it('notifies clients for account, mail, classification, deletion, and category writes', async () => {
	database = createDatabase(':memory:');
	const { response, read } = connect();
	expect(response.headers.get('content-type')).toBe('text/event-stream');
	expect(response.headers.get('cache-control')).toContain('no-store');
	expect(await read()).toBe('data: changed\n\n');

	const writes = [
		() => upsertAccount(database!, { email: 'one@example.com' }),
		() => setAccountHistoryId(database!, 'one@example.com', '123'),
		() => upsertEmails(database!, 'one@example.com', [{ id: 'mail', subject: 'New mail' }]),
		() => saveClassification(database!, 'one@example.com', 'mail', {
			category: 'action', importance: null, model: 'test', categoryConfidence: 1,
			importanceConfidence: null, categoryProbabilities: { action: 1 }, importanceProbabilities: {}
		}),
		() => saveClassificationError(database!, 'one@example.com', 'mail', new Error('Retry')),
		() => markDeleted(database!, 'one@example.com', ['mail']),
		() => saveCategory(database!, { id: 'action', name: 'Reply', description: 'Tasks.', level: 'important' }),
		() => deleteCategory(database!, 'action')
	];
	for (const write of writes) {
		write();
		expect(await read()).toBe('data: changed\n\n');
	}
});

it('broadcasts to clients, cleans up closed streams, and refreshes after reconnect', async () => {
	const first = connect();
	const second = connect();
	await first.read();
	await second.read();
	publishStateChange();
	expect(await first.read()).toBe('data: changed\n\n');
	expect(await second.read()).toBe('data: changed\n\n');
	first.abort.abort();
	expect((await first.reader.read()).done).toBe(true);
	await second.reader.cancel();
	publishStateChange();
	const reconnected = connect();
	expect(await reconnected.read()).toBe('data: changed\n\n');
	publishStateChange();
	expect(await reconnected.read()).toBe('data: changed\n\n');
});

it('coalesces notifications while a client has an unread signal', async () => {
	const { read, reader, abort } = connect();
	publishStateChange();
	publishStateChange();
	await Promise.resolve();
	expect(await read()).toBe('data: changed\n\n');
	abort.abort();
	expect((await reader.read()).done).toBe(true);
});
