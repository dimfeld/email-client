import { afterEach, describe, expect, it } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, listEmails, upsertEmails } from './db';

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
