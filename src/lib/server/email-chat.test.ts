import { afterEach, expect, test } from 'bun:test';
import type { generateText } from 'ai';
import { createDatabase, listEmails, markDeleted, upsertEmails } from './db';
import { chatWithEmail, createEmailChatTools } from './email-chat';

const database = createDatabase(':memory:');
afterEach(() => database.exec('DELETE FROM emails'));
const context = { toolCallId: 'test', messages: [], context: {} };
function seed() {
	upsertEmails(database, 'a@test.com', [{ id: 'one', subject: 'Launch', bodyText: 'Launch is Friday.', labels: [] }]);
	upsertEmails(database, 'b@test.com', [{ id: 'two', subject: 'Private', bodyText: 'Other account.' }]);
	return { one: listEmails(database, 'a@test.com')[0].id, two: listEmails(database, 'b@test.com')[0].id };
}

test('tools enforce account scope and record only messages read', async () => {
	const { one, two } = seed();
	const { tools, readSources } = createEmailChatTools(database, 'a@test.com');
	expect(Object.keys(tools)).toEqual(['search', 'read']);
	const found = await tools.search.execute!({ query: '', offset: 0, limit: 10 }, context);
	expect(found).toMatchObject({ results: [{ id: one }] });
	expect(readSources.size).toBe(0);
	await expect(tools.read.execute!({ id: two, offset: 0, length: 100 }, context)).rejects.toThrow('selected account');
	expect(await tools.read.execute!({ id: one, offset: 0, length: 6 }, context)).toMatchObject({ body: 'Launch', nextOffset: 6 });
	expect(readSources.get(one)?.href).toBe(`/?account=a%40test.com&message=${one}`);
	markDeleted(database, 'a@test.com', ['one']);
	await expect(tools.read.execute!({ id: one, offset: 0, length: 100 }, context)).rejects.toThrow('not available');
});

test('Jev relevance checks only the selected account and does not count as reading a source', async () => {
	const { one, two } = seed();
	const seen: number[] = [];
	const { tools, readSources } = createEmailChatTools(database, 'a@test.com', async (_, email) => { seen.push(email.id); return true; });
	expect(await tools.relevance!.execute!({ question: 'When is launch?', ids: [one] }, context)).toEqual([{ id: one, relevant: true }]);
	await expect(tools.relevance!.execute!({ question: 'When?', ids: [two] }, context)).rejects.toThrow('selected account');
	expect(seen).toEqual([one]); expect(readSources.size).toBe(0);
});

test('passes conversation to the model and returns verified sources', async () => {
	const { one } = seed();
	const messages = [{ role: 'user' as const, content: 'Find the launch.' }, { role: 'assistant' as const, content: 'I found it.' }, { role: 'user' as const, content: 'When is it?' }];
	const generate = (async (options: Parameters<typeof generateText>[0]) => {
		expect(options.messages).toEqual(messages);
		expect(options.instructions).toContain('untrusted data');
		await options.tools!.read.execute!({ id: one, offset: 0, length: 100 }, context);
		return { output: { answer: `Friday [${one}].`, sourceIds: [one] } };
	}) as typeof generateText;
	const result = await chatWithEmail(database, messages, 'a@test.com', undefined, { apiKey: 'test', generate });
	expect(result.sources.map(source => source.id)).toEqual([one]);
});

test('rejects invented citations and stops tools after cancellation', async () => {
	const { one } = seed();
	const generate = (async () => ({ output: { answer: `Invented [${one}].`, sourceIds: [] } })) as unknown as typeof generateText;
	await expect(chatWithEmail(database, [{ role: 'user', content: 'When?' }], undefined, undefined, { apiKey: 'test', generate })).rejects.toThrow('unverified source');
	const abort = new AbortController(); abort.abort();
	const { tools } = createEmailChatTools(database, undefined, undefined, abort.signal);
	await expect(tools.search.execute!({ query: '', offset: 0, limit: 1 }, context)).rejects.toThrow();
	await expect(chatWithEmail(database, [{ role: 'user', content: 'When?' }], undefined, undefined, { apiKey: '' })).rejects.toThrow('OPENAI_API_KEY');
});
