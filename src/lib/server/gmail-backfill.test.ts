import { afterEach, describe, expect, it } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import type { EmailClassifier } from './classifier';
import { createDatabase, listAccounts, upsertAccount } from './db';
import { GogCommandError } from './gog';
import {
	backfillGmail,
	buildGmailBackfillQuery,
	GMAIL_BACKFILL_INITIAL_LOOKBACK_MS,
	GMAIL_BACKFILL_OVERLAP_MS,
	isGmailRateLimitError
} from './gmail-backfill';

let database: DatabaseSync | undefined;

afterEach(() => {
	database?.close();
	database = undefined;
});

const classify: EmailClassifier = async () => ({
	category: 'action',
	importance: 'useful',
	model: 'test',
	categoryConfidence: 1,
	importanceConfidence: 1,
	categoryProbabilities: { action: 1 },
	importanceProbabilities: { useful: 1 }
});

describe('Gmail backfill', () => {
	it('uses a one-hour initial window and records the cursor separately per account', async () => {
		database = createDatabase(':memory:');
		upsertAccount(database, { email: 'one@example.com', client: 'one' });
		upsertAccount(database, { email: 'two@example.com', client: 'two' });
		const now = new Date('2026-09-20T12:00:00.000Z');
		const commands: string[][] = [];

		await expect(
			backfillGmail({
				database,
				classify,
				now: () => now,
				runJson: async (command) => {
					commands.push(command);
					return { messages: [] };
				}
			})
		).resolves.toMatchObject({ accounts: 2, succeeded: 2, failed: 0 });

		expect(commands).toHaveLength(2);
		for (const command of commands) {
			expect(command[4]).toBe(
				`in:inbox after:${Math.floor(
					(now.getTime() - GMAIL_BACKFILL_INITIAL_LOOKBACK_MS) / 1000
				)}`
			);
		}
		expect(listAccounts(database).map((account) => account.lastBackfillAt)).toEqual([
			now.toISOString(),
			now.toISOString()
		]);
	});

	it('uses the per-account cursor with an overlap and does not advance a rate-limited account', async () => {
		database = createDatabase(':memory:');
		upsertAccount(database, { email: 'limited@example.com', client: 'limited' });
		upsertAccount(database, { email: 'working@example.com', client: 'working' });
		const previous = new Date('2026-09-20T11:00:00.000Z');
		const now = new Date('2026-09-20T12:00:00.000Z');
		database
			.prepare('UPDATE accounts SET last_backfill_at = ? WHERE email = ?')
			.run(previous.toISOString(), 'limited@example.com');

		const commands: string[][] = [];
		const result = await backfillGmail({
			database,
			classify,
			now: () => now,
			runJson: async (command) => {
				commands.push(command);
				if (command.includes('limited@example.com')) {
					throw new GogCommandError('429 Too Many Requests', 429);
				}
				return {
					messages: [
						{
							id: 'message-1',
							subject: 'Working',
							labels: ['INBOX']
						}
					]
				};
			}
		});

		expect(result).toMatchObject({ accounts: 2, succeeded: 1, failed: 1, stored: 1 });
		expect(commands.find((command) => command.includes('limited@example.com'))?.[4]).toBe(
			buildGmailBackfillQuery(previous.toISOString(), now)
		);
		const accounts = listAccounts(database);
		expect(accounts.find((account) => account.email === 'limited@example.com')?.lastBackfillAt).toBe(
			previous.toISOString()
		);
		expect(accounts.find((account) => account.email === 'working@example.com')?.lastBackfillAt).toBe(
			now.toISOString()
		);
	});

	it('recognizes common Gmail rate-limit errors', () => {
		expect(isGmailRateLimitError(new GogCommandError('429 Too Many Requests', 429))).toBe(true);
		expect(isGmailRateLimitError(new Error('RESOURCE_EXHAUSTED'))).toBe(true);
		expect(isGmailRateLimitError(new Error('invalid query'))).toBe(false);
		expect(GMAIL_BACKFILL_OVERLAP_MS).toBe(5 * 60 * 1000);
	});
});
