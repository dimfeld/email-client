import { afterEach, describe, expect, it } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { createDatabase, listEmails, upsertAccount, upsertEmails } from './db';
import { applyGmailMessageAction, runGmailMessageAction } from './gmail-actions';

let database: DatabaseSync | undefined;

afterEach(() => {
	database?.close();
	database = undefined;
});

describe('Gmail message actions', () => {
	it('archives a message with its account and client', async () => {
		let command: string[] = [];
		await runGmailMessageAction(
			{ email: 'one@example.com', client: 'work' },
			'gmail-message',
			'archive',
			async (value) => {
				command = value;
				return {};
			}
		);
		expect(command).toEqual([
			'gog',
			'gmail',
			'archive',
			'gmail-message',
			'--account',
			'one@example.com',
			'--client',
			'work',
			'--json',
			'--no-input',
			'--force'
		]);
	});

	it('moves a message to Gmail Trash for delete', async () => {
		let command: string[] = [];
		await runGmailMessageAction(
			{ email: 'one@example.com', client: 'default' },
			'gmail-message',
			'delete',
			async (value) => {
				command = value;
				return {};
			}
		);
		expect(command.slice(0, 4)).toEqual(['gog', 'gmail', 'trash', 'gmail-message']);
	});

	it('updates local state only after Gmail succeeds and keeps archived mail recoverable', async () => {
		database = createDatabase(':memory:');
		upsertAccount(database, { email: 'one@example.com' });
		const message = { id: 'gmail-message', subject: 'A message', labels: ['INBOX'] };
		upsertEmails(database, 'one@example.com', [message]);

		await applyGmailMessageAction(
			database,
			{ email: 'one@example.com', client: 'default' },
			message.id,
			'archive',
			async () => ({})
		);
		expect(listEmails(database)).toHaveLength(0);
		expect(
			database.prepare('SELECT archived_at, deleted_at FROM emails WHERE gmail_id = ?').get(message.id)
		).toMatchObject({ archived_at: expect.any(String), deleted_at: null });

		upsertEmails(database, 'one@example.com', [message]);
		expect(listEmails(database)).toHaveLength(1);
	});

	it('does not hide a message when Gmail rejects the action', async () => {
		database = createDatabase(':memory:');
		upsertAccount(database, { email: 'one@example.com' });
		upsertEmails(database, 'one@example.com', [{ id: 'gmail-message', subject: 'A message' }]);

		await expect(
			applyGmailMessageAction(
				database,
				{ email: 'one@example.com', client: 'default' },
				'gmail-message',
				'delete',
				async () => {
					throw new Error('Gmail unavailable');
				}
			)
		).rejects.toThrow('Gmail unavailable');
		expect(listEmails(database)).toHaveLength(1);
	});
});
