import { afterEach, describe, expect, it } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import type { EmailClassifier } from './classifier';
import { createDatabase, listAccounts, listEmails, upsertAccount } from './db';
import {
	groupAccountsBySubscription,
	parseGmailNotification,
	processGmailNotification,
	type GmailSubscriberAccount
} from './gmail-subscriber';

let database: DatabaseSync | undefined;

afterEach(() => {
	database?.close();
	database = undefined;
});

const classify: EmailClassifier = async () => ({
	category: 'action',
	importance: 'useful',
	hasActionItem: true,
	actionItemProbability: 1,
	hasReminder: false,
	reminderProbability: 0,
	model: 'test',
	categoryConfidence: 1,
	importanceConfidence: 1,
	categoryProbabilities: { action: 1 },
	importanceProbabilities: { useful: 1 }
});

describe('Gmail Pub/Sub routing', () => {
	it('uses one subscription group for accounts that share a subscription', () => {
		const accounts: GmailSubscriberAccount[] = [
			{
				email: 'one@example.com',
				client: 'default',
				subscription: 'projects/p/subscriptions/mail',
				historyId: '10'
			},
			{
				email: 'two@example.com',
				client: 'work',
				subscription: 'projects/p/subscriptions/mail',
				historyId: '20'
			}
		];

		const groups = groupAccountsBySubscription(accounts);

		expect(groups.size).toBe(1);
		expect(groups.get('projects/p/subscriptions/mail')?.get('two@example.com')?.client).toBe(
			'work'
		);
	});

	it('parses the Gmail account and history ID from Pub/Sub data', () => {
		const data = Buffer.from(
			JSON.stringify({ emailAddress: 'One@Example.com', historyId: '123456' })
		);
		expect(parseGmailNotification(data)).toEqual({
			emailAddress: 'One@Example.com',
			historyId: '123456'
		});
		expect(
			parseGmailNotification(
				Buffer.from(JSON.stringify({ emailAddress: 'daniel@danielimfeld.com', historyId: 28086859 }))
			)
		).toEqual({ emailAddress: 'daniel@danielimfeld.com', historyId: '28086859' });
		expect(() => parseGmailNotification(Buffer.from('{}'))).toThrow('emailAddress');
	});
});

describe('Gmail notification processing', () => {
	it('fetches inbox messages with gog and advances only the matching account cursor', async () => {
		database = createDatabase(':memory:');
		upsertAccount(database, {
			email: 'one@example.com',
			client: 'work',
			subscription: 'projects/p/subscriptions/mail'
		});
		upsertAccount(database, {
			email: 'two@example.com',
			client: 'default',
			subscription: 'projects/p/subscriptions/mail'
		});
		const account: GmailSubscriberAccount = {
			email: 'one@example.com',
			client: 'work',
			subscription: 'projects/p/subscriptions/mail',
			historyId: '100'
		};
		const commands: string[][] = [];
		const runJson = async (command: string[]): Promise<unknown> => {
			commands.push(command);
			if (command.includes('history')) {
				return { historyId: '105', messages: ['inbox-message', 'sent-message'] };
			}
			const messageId = command[3];
			return {
				body: `${messageId} body`,
				headers: {
					from: 'Sender <sender@example.com>',
					to: 'one@example.com',
					subject: messageId,
					date: 'Fri, 18 Sep 2026 12:00:00 +0000'
				},
				message: {
					id: messageId,
					threadId: `thread-${messageId}`,
					snippet: `${messageId} snippet`,
					labelIds: messageId === 'inbox-message' ? ['INBOX'] : ['SENT']
				}
			};
		};

		const result = await processGmailNotification(
			account,
			{ emailAddress: 'one@example.com', historyId: '105' },
			{ database, classify, runJson }
		);

		expect(result.stored).toBe(1);
		expect(listEmails(database).map((email) => email.gmailId)).toEqual(['inbox-message']);
		expect(listAccounts(database).find((item) => item.email === 'one@example.com')?.historyId).toBe(
			'105'
		);
		expect(listAccounts(database).find((item) => item.email === 'two@example.com')?.historyId).toBeNull();
		expect(commands[0]).toContain('history');
		expect(commands[0]).toContain('work');
	});

	it('bootstraps an existing watch cursor and ignores its immediate notification', async () => {
		database = createDatabase(':memory:');
		upsertAccount(database, {
			email: 'one@example.com',
			client: 'default',
			subscription: 'projects/p/subscriptions/mail'
		});
		const account: GmailSubscriberAccount = {
			email: 'one@example.com',
			client: 'default',
			subscription: 'projects/p/subscriptions/mail',
			historyId: null
		};
		let calls = 0;

		const result = await processGmailNotification(
			account,
			{ emailAddress: 'one@example.com', historyId: '100' },
			{
				database,
				classify,
				runJson: async () => {
					calls += 1;
					return { watch: { historyId: '100' } };
				}
			}
		);

		expect(result).toEqual({ stored: 0, classified: 0, deleted: 0 });
		expect(calls).toBe(1);
		expect(account.historyId).toBe('100');
		expect(listAccounts(database)[0].historyId).toBe('100');
	});
});
