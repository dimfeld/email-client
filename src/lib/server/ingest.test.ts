import { afterEach, describe, expect, it } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import type { EmailClassifier } from './classifier';
import { createDatabase, listAccounts, listEmails, upsertAccount } from './db';
import { ingestGmailPayload, parseGmailPayload } from './ingest';

let database: DatabaseSync | undefined;

afterEach(() => {
	database?.close();
	database = undefined;
});

const classify: EmailClassifier = async (email) => ({
	category: email.subject?.includes('Reply') ? 'action' : 'newsletter',
	useful: Boolean(email.subject?.includes('Reply')),
	model: 'jev-test',
	categoryConfidence: 0.8,
	usefulnessConfidence: 0.9,
	categoryProbabilities: { action: 0.8, newsletter: 0.2 },
	usefulnessProbabilities: { useful: 0.9, not_useful: 0.1 }
});

describe('Gmail ingestion', () => {
	it('stores accounts separately and does not classify an unchanged duplicate twice', async () => {
		database = createDatabase(':memory:');
		let calls = 0;
		const countingClassifier: EmailClassifier = async (email) => {
			calls += 1;
			return classify(email);
		};
		const message = {
			id: 'same-gmail-id',
			subject: 'Reply requested',
			from: 'Alex <alex@example.com>',
			date: '2026-09-18T12:00:00Z'
		};

		await ingestGmailPayload(
			database,
			{ source: 'gmail', account: 'one@example.com', deletedMessageIds: [], messages: [message] },
			countingClassifier
		);
		await ingestGmailPayload(
			database,
			{ source: 'gmail', account: 'one@example.com', deletedMessageIds: [], messages: [message] },
			countingClassifier
		);
		await ingestGmailPayload(
			database,
			{ source: 'gmail', account: 'two@example.com', deletedMessageIds: [], messages: [message] },
			countingClassifier
		);

		expect(calls).toBe(2);
		expect(listEmails(database)).toHaveLength(2);
		expect(listAccounts(database).map((account) => account.email)).toEqual([
			'one@example.com',
			'two@example.com'
		]);
	});

	it('stores the Jev category, usefulness decision, and confidence', async () => {
		database = createDatabase(':memory:');
		await ingestGmailPayload(
			database,
			{
				source: 'gmail',
				account: 'one@example.com',
				deletedMessageIds: [],
				messages: [{ id: 'message-1', subject: 'Reply requested' }]
			},
			classify
		);

		const [email] = listEmails(database);
		expect(email.category).toBe('action');
		expect(email.useful).toBe(true);
		expect(email.categoryConfidence).toBe(0.8);
		expect(email.usefulnessConfidence).toBe(0.9);
	});

	it('keeps a downloaded message when classification fails', async () => {
		database = createDatabase(':memory:');
		await expect(
			ingestGmailPayload(
				database,
				{
					source: 'gmail',
					account: 'one@example.com',
					deletedMessageIds: [],
					messages: [{ id: 'message-1', subject: 'Unknown' }]
				},
				async () => {
					throw new Error('Jev unavailable');
				}
			)
		).rejects.toThrow('classification failed');

		const [email] = listEmails(database);
		expect(email.subject).toBe('Unknown');
		expect(email.classificationError).toBe('Jev unavailable');
	});

	it('marks deleted Gmail messages as hidden', async () => {
		database = createDatabase(':memory:');
		await ingestGmailPayload(
			database,
			{
				source: 'gmail',
				account: 'one@example.com',
				deletedMessageIds: [],
				messages: [{ id: 'message-1', subject: 'Reply requested' }]
			},
			classify
		);
		await ingestGmailPayload(
			database,
			{
				source: 'gmail',
				account: 'one@example.com',
				deletedMessageIds: ['message-1'],
				messages: []
			},
			classify
		);

		expect(listEmails(database)).toHaveLength(0);
	});
});

describe('Gmail payload validation', () => {
	it('accepts gog field variants and rejects a missing account', () => {
		expect(
			parseGmailPayload({
				source: 'gmail',
				account: 'one@example.com',
				deleted_message_ids: ['gone'],
				messages: [{ id: 'one', thread_id: 'thread', labelIds: ['INBOX'] }]
			})
		).toMatchObject({
			account: 'one@example.com',
			deletedMessageIds: ['gone'],
			messages: [{ id: 'one', threadId: 'thread', labels: ['INBOX'] }]
		});
		expect(() => parseGmailPayload({ source: 'gmail', messages: [] })).toThrow('account');
	});

	it('preserves an existing subscription when a webhook refreshes the account', async () => {
		database = createDatabase(':memory:');
		upsertAccount(database, {
			email: 'one@example.com',
			client: 'work',
			subscription: 'projects/p/subscriptions/mail'
		});
		await ingestGmailPayload(
			database,
			{ source: 'gmail', account: 'one@example.com', deletedMessageIds: [], messages: [] },
			classify
		);
		expect(listAccounts(database)[0].subscription).toBe('projects/p/subscriptions/mail');
		expect(listAccounts(database)[0].client).toBe('work');
	});
});
