import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import type { EmailClassifier } from './classifier';
import { createDatabase, listAccounts, listEmails, upsertAccount } from './db';
import { GoogleApiError } from './google-api';
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

describe('Gmail backfill', () => {
	it('uses a one-hour initial window and records the cursor separately per account', async () => {
		database = createDatabase(':memory:');
		upsertAccount(database, { email: 'one@example.com', refreshToken: 'one' });
		upsertAccount(database, { email: 'two@example.com', refreshToken: 'two' });
		const now = new Date('2026-09-20T12:00:00.000Z');
		const queries: string[] = [];
		const logs = spyOn(console, 'log').mockImplementation(() => undefined);

		try {
			await expect(
				backfillGmail({
					database,
					classify,
					now: () => now,
					listMessages: async (_account, query) => {
						queries.push(query);
						return [];
					}
				})
			).resolves.toMatchObject({ accounts: 2, succeeded: 2, failed: 0 });
			expect(logs).not.toHaveBeenCalled();
		} finally {
			logs.mockRestore();
		}

		expect(queries).toHaveLength(2);
		for (const query of queries) {
			expect(query).toBe(
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
		upsertAccount(database, { email: 'limited@example.com', refreshToken: 'limited' });
		upsertAccount(database, { email: 'working@example.com', refreshToken: 'working' });
		const previous = new Date('2026-09-20T11:00:00.000Z');
		const now = new Date('2026-09-20T12:00:00.000Z');
		database
			.prepare('UPDATE accounts SET last_backfill_at = ? WHERE email = ?')
			.run(previous.toISOString(), 'limited@example.com');

		const queries = new Map<string, string>();
		const result = await backfillGmail({
			database,
			classify,
			now: () => now,
			listMessages: async (account, query) => {
					queries.set(account.email, query);
					if (account.email === 'limited@example.com') {
						throw new GoogleApiError('429 Too Many Requests', 429);
					}
					return [
						{
								id: 'message-1',
								subject: 'Working',
								bodyText: 'Working',
								bodyHtml: '<p>Working</p>',
								labels: ['INBOX']
						}
					];
			}
		});

		expect(result).toMatchObject({ accounts: 2, succeeded: 1, failed: 1, stored: 1 });
		expect(queries.get('limited@example.com')).toBe(
			buildGmailBackfillQuery(previous.toISOString(), now)
		);
		const accounts = listAccounts(database);
		expect(accounts.find((account) => account.email === 'limited@example.com')?.lastBackfillAt).toBe(
			previous.toISOString()
		);
		expect(accounts.find((account) => account.email === 'working@example.com')?.lastBackfillAt).toBe(
			now.toISOString()
		);
		expect(listEmails(database)[0]).toMatchObject({
			bodyText: 'Working',
			bodyHtml: '<p>Working</p>'
		});
	});

	it('recognizes common Gmail rate-limit errors', () => {
		expect(isGmailRateLimitError(new GoogleApiError('429 Too Many Requests', 429))).toBe(true);
		expect(isGmailRateLimitError(new Error('RESOURCE_EXHAUSTED'))).toBe(true);
		expect(isGmailRateLimitError(new Error('invalid query'))).toBe(false);
		expect(GMAIL_BACKFILL_OVERLAP_MS).toBe(5 * 60 * 1000);
	});
});
