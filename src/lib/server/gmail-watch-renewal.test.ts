import { afterEach, describe, expect, it } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { createDatabase, listAccounts, upsertAccount } from './db';
import { renewGmailWatches } from './gmail-watch-renewal';

let database: DatabaseSync | undefined;

afterEach(() => {
	database?.close();
	database = undefined;
});

describe('Gmail watch renewal', () => {
	it('renews enabled watches and preserves an existing history cursor', async () => {
		database = createDatabase(':memory:');
		upsertAccount(database, {
			email: 'one@example.com',
			client: 'work',
			topic: 'projects/p/topics/mail',
			subscription: 'projects/p/subscriptions/mail'
		});
		upsertAccount(database, {
			email: 'two@example.com',
			client: 'default',
			topic: 'projects/p/topics/mail'
		});
		const commands: string[][] = [];
		const runJson = async (command: string[]): Promise<unknown> => {
			commands.push(command);
			return { watch: { historyId: command.includes('one@example.com') ? '200' : '300' } };
		};

		await expect(renewGmailWatches(database, runJson)).resolves.toEqual({ renewed: 2, failed: 0 });

		expect(commands).toHaveLength(2);
		expect(commands[0]).toEqual([
			'gog',
			'gmail',
			'watch',
			'renew',
			'--account',
			'one@example.com',
			'--client',
			'work',
			'--json',
			'--no-input'
		]);
		expect(listAccounts(database).map((account) => account.historyId)).toEqual(['200', '300']);
	});

	it('does not let one failed account prevent other watches from renewing', async () => {
		database = createDatabase(':memory:');
		upsertAccount(database, { email: 'failed@example.com', topic: 'projects/p/topics/mail' });
		upsertAccount(database, { email: 'working@example.com', topic: 'projects/p/topics/mail' });

		await expect(
			renewGmailWatches(database, async (command) => {
			if (command.includes('failed@example.com')) throw new Error('temporary gog failure');
			return { historyId: '400' };
		})
		).resolves.toEqual({ renewed: 1, failed: 1 });

		expect(listAccounts(database).find((account) => account.email === 'working@example.com')?.historyId).toBe(
			'400'
		);
	});
});
