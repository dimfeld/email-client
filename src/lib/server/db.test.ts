import { afterEach, describe, expect, it } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, listAccounts, listEmails, upsertAccount, upsertEmails } from './db';

let database: DatabaseSync | undefined;
let directory: string | undefined;

afterEach(() => {
	database?.close();
	database = undefined;
	if (directory) rmSync(directory, { recursive: true, force: true });
	directory = undefined;
});

describe('email body storage', () => {
	it('stores plain text and HTML separately', () => {
		database = createDatabase(':memory:');
		upsertEmails(database, 'one@example.com', [{
			id: 'message',
			bodyText: 'Readable text',
			bodyHtml: '<p style="color:red">Styled HTML</p>'
		}]);

		expect(listEmails(database)[0]).toMatchObject({
			bodyText: 'Readable text',
			bodyHtml: '<p style="color:red">Styled HTML</p>'
		});
	});

	it('migrates a legacy body without losing HTML', () => {
		directory = mkdtempSync(join(tmpdir(), 'email-check-body-migration-'));
		const path = join(directory, 'test.sqlite');
		database = createDatabase(path);
		upsertEmails(database, 'one@example.com', [{ id: 'message' }]);
		database.exec(`ALTER TABLE emails ADD COLUMN body TEXT NOT NULL DEFAULT '';
			UPDATE emails SET body = '<html><body><p style="color:red">Legacy</p></body></html>';
			ALTER TABLE emails DROP COLUMN body_text;
			ALTER TABLE emails DROP COLUMN body_html;`);
		database.close();

		database = createDatabase(path);
		expect(listEmails(database)[0]).toMatchObject({
			bodyText: '',
			bodyHtml: '<html><body><p style="color:red">Legacy</p></body></html>'
		});
	});
});

describe('email classification storage', () => {
	it('adds classification and extraction fields to an existing database', () => {
		directory = mkdtempSync(join(tmpdir(), 'email-check-classification-migration-'));
		const path = join(directory, 'test.sqlite');
		database = createDatabase(path);
		database.exec(`ALTER TABLE emails DROP COLUMN has_action_item;
			ALTER TABLE emails DROP COLUMN action_item_probability;
			ALTER TABLE emails DROP COLUMN has_reminder;
			ALTER TABLE emails DROP COLUMN reminder_probability;
			ALTER TABLE emails DROP COLUMN action_items_json;
			ALTER TABLE emails DROP COLUMN reminders_json;
			ALTER TABLE emails DROP COLUMN extraction_model;
			ALTER TABLE emails DROP COLUMN extraction_error;
			ALTER TABLE emails DROP COLUMN extracted_at;`);
		database.close();

		database = createDatabase(path);
		const columns = database.prepare('PRAGMA table_info(emails)').all() as Array<{ name: string }>;
		expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
			'has_action_item',
			'action_item_probability',
			'has_reminder',
			'reminder_probability',
			'action_items_json',
			'reminders_json',
			'extraction_model',
			'extraction_error',
			'extracted_at'
		]));
	});
});

describe('Google OAuth account migration', () => {
	it('adds refresh-token storage to a database created by the gog integration', () => {
		directory = mkdtempSync(join(tmpdir(), 'email-check-oauth-migration-'));
		const path = join(directory, 'test.sqlite');
		database = createDatabase(path);
		database.exec(`ALTER TABLE accounts DROP COLUMN google_refresh_token;
			ALTER TABLE accounts ADD COLUMN gog_client TEXT NOT NULL DEFAULT 'default';`);
		database.close();

		database = createDatabase(path);
		upsertAccount(database, { email: 'owner@example.com', refreshToken: 'refresh-token' });
		expect(listAccounts(database)[0]).toMatchObject({
			email: 'owner@example.com', refreshToken: 'refresh-token'
		});
	});
});
