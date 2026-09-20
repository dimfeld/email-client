import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Category, Classification, IncomingEmail, StoredEmail } from './types';

import { publishStateChange } from './state-events';
import { defaultCategories } from './default-categories';

const defaultPath = resolve(process.env.DATABASE_PATH ?? 'data/email-check.sqlite');
let sharedDatabase: DatabaseSync | undefined;

const schema = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  email TEXT PRIMARY KEY,
  gog_client TEXT NOT NULL DEFAULT 'default',
  topic TEXT,
  subscription TEXT,
  history_id TEXT,
  last_backfill_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY,
  account_email TEXT NOT NULL REFERENCES accounts(email) ON DELETE CASCADE,
  gmail_id TEXT NOT NULL,
  thread_id TEXT,
  from_address TEXT NOT NULL DEFAULT '',
  to_addresses TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  message_date TEXT,
  snippet TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  body_html TEXT,
  body_truncated INTEGER NOT NULL DEFAULT 0 CHECK (body_truncated IN (0, 1)),
  labels_json TEXT NOT NULL DEFAULT '[]',
  content_hash TEXT NOT NULL,
  category TEXT,
  useful INTEGER CHECK (useful IN (0, 1)),
  has_action_item INTEGER CHECK (has_action_item IN (0, 1)),
  action_item_probability REAL,
  has_reminder INTEGER CHECK (has_reminder IN (0, 1)),
  reminder_probability REAL,
  category_confidence REAL,
  usefulness_confidence REAL,
  category_probabilities_json TEXT,
  usefulness_probabilities_json TEXT,
  classification_model TEXT,
  classification_error TEXT,
  classified_at TEXT,
  deleted_at TEXT,
  archived_at TEXT,
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_email, gmail_id)
);

CREATE INDEX IF NOT EXISTS idx_emails_useful_date
ON emails(useful, message_date DESC);

CREATE INDEX IF NOT EXISTS idx_emails_category_date
ON emails(category, message_date DESC);
`;

export function createDatabase(path = defaultPath): DatabaseSync {
	if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
	const database = new DatabaseSync(path);
	database.exec(schema);
	const accountColumns = database.prepare('PRAGMA table_info(accounts)').all() as Array<{
		name: string;
	}>;
	if (!accountColumns.some((column) => column.name === 'history_id')) {
		database.exec('ALTER TABLE accounts ADD COLUMN history_id TEXT');
	}
	if (!accountColumns.some((column) => column.name === 'last_backfill_at')) {
		database.exec('ALTER TABLE accounts ADD COLUMN last_backfill_at TEXT');
	}
	withTransaction(database, () => {
		const exists = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'categories'").get();
		if (!exists) {
			database.exec(`CREATE TABLE categories (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL COLLATE NOCASE UNIQUE,
				description TEXT NOT NULL,
				level TEXT NOT NULL CHECK (level IN ('important', 'useful', 'other', 'auto'))
			)`);
			const insert = database.prepare('INSERT INTO categories (id, name, description, level) VALUES (?, ?, ?, ?)');
			for (const category of defaultCategories) insert.run(category.id, category.name, category.description, category.level);
		} else {
			const columns = database.prepare('PRAGMA table_info(categories)').all() as Array<{ name: string }>;
			const table = database.prepare("SELECT sql FROM sqlite_master WHERE name = 'categories'").get() as { sql: string };
			if (!table.sql.includes("'auto'")) {
				const level = columns.some((column) => column.name === 'level')
					? 'level'
					: "CASE WHEN important = 1 THEN 'important' ELSE 'auto' END";
				database.exec(`CREATE TABLE categories_updated (
					id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
					description TEXT NOT NULL, level TEXT NOT NULL CHECK (level IN ('important', 'useful', 'other', 'auto'))
				);
				INSERT INTO categories_updated SELECT id, name, description, ${level} FROM categories ORDER BY rowid;
				DROP TABLE categories;
				ALTER TABLE categories_updated RENAME TO categories;`);
			}
		}
		const emailColumns = database.prepare('PRAGMA table_info(emails)').all() as Array<{ name: string }>;
		if (!emailColumns.some((column) => column.name === 'body_text')) {
			database.exec(`ALTER TABLE emails ADD COLUMN body_text TEXT NOT NULL DEFAULT '';
				ALTER TABLE emails ADD COLUMN body_html TEXT;
				UPDATE emails SET
					body_text = body,
					body_html = CASE
						WHEN lower(body) LIKE '%<html%'
							OR lower(body) LIKE '%<body%'
							OR lower(body) LIKE '%<div%'
							OR lower(body) LIKE '%<p%'
							OR lower(body) LIKE '%<table%'
							OR lower(body) LIKE '%<br%'
							OR lower(body) LIKE '%<a %'
							OR lower(body) LIKE '%<span%'
						THEN body
						ELSE NULL
					END;`);
		}
		database.exec("UPDATE emails SET body_text = '' WHERE body_html IS NOT NULL AND body_text = body_html");
		if (!emailColumns.some((column) => column.name === 'importance')) {
			database.exec(`ALTER TABLE emails ADD COLUMN importance TEXT CHECK (importance IN ('important', 'useful', 'other'));
				ALTER TABLE emails ADD COLUMN importance_confidence REAL;
				ALTER TABLE emails ADD COLUMN importance_probabilities_json TEXT;
				UPDATE emails SET importance = CASE useful WHEN 1 THEN 'useful' WHEN 0 THEN 'other' ELSE NULL END;`);
		}
		if (!emailColumns.some((column) => column.name === 'archived_at')) {
			database.exec('ALTER TABLE emails ADD COLUMN archived_at TEXT');
		}
		if (!emailColumns.some((column) => column.name === 'has_action_item')) {
			database.exec(`ALTER TABLE emails ADD COLUMN has_action_item INTEGER CHECK (has_action_item IN (0, 1));
				ALTER TABLE emails ADD COLUMN action_item_probability REAL;
				ALTER TABLE emails ADD COLUMN has_reminder INTEGER CHECK (has_reminder IN (0, 1));
				ALTER TABLE emails ADD COLUMN reminder_probability REAL;`);
		}
	});
	database.exec('PRAGMA optimize');
	return database;
}

export function getDatabase(): DatabaseSync {
	sharedDatabase ??= createDatabase();
	return sharedDatabase;
}

export function closeSharedDatabase(): void {
	sharedDatabase?.close();
	sharedDatabase = undefined;
}

export function upsertAccount(
	database: DatabaseSync,
	account: { email: string; client?: string; topic?: string | null; subscription?: string | null }
): void {
	const now = new Date().toISOString();
	database
		.prepare(
			`INSERT INTO accounts (email, gog_client, topic, subscription, created_at, updated_at)
       VALUES ($email, $client, $topic, $subscription, $now, $now)
       ON CONFLICT(email) DO UPDATE SET
         gog_client = CASE WHEN $hasClient = 1 THEN excluded.gog_client ELSE accounts.gog_client END,
         topic = COALESCE(excluded.topic, accounts.topic),
         subscription = COALESCE(excluded.subscription, accounts.subscription),
         updated_at = excluded.updated_at`
		)
		.run({
			$email: account.email,
			$client: account.client ?? 'default',
			$hasClient: account.client ? 1 : 0,
			$topic: account.topic ?? null,
			$subscription: account.subscription ?? null,
			$now: now
		});
	publishStateChange();
}

export function listAccounts(database: DatabaseSync): Array<{
	email: string;
	client: string;
	topic: string | null;
	subscription: string | null;
	historyId: string | null;
	lastBackfillAt: string | null;
	enabled: boolean;
}> {
	const rows = database
		.prepare(
			'SELECT email, gog_client, topic, subscription, history_id, last_backfill_at, enabled FROM accounts ORDER BY email'
		)
		.all() as Array<Record<string, unknown>>;
	return rows.map((row) => ({
		email: String(row.email),
		client: String(row.gog_client),
		topic: row.topic === null ? null : String(row.topic),
		subscription: row.subscription === null ? null : String(row.subscription),
		historyId: row.history_id === null ? null : String(row.history_id),
		lastBackfillAt: row.last_backfill_at === null ? null : String(row.last_backfill_at),
		enabled: Boolean(row.enabled)
	}));
}

export function setAccountHistoryId(
	database: DatabaseSync,
	accountEmail: string,
	historyId: string
): void {
	database
		.prepare('UPDATE accounts SET history_id = ?, updated_at = ? WHERE email = ?')
		.run(historyId, new Date().toISOString(), accountEmail);
	publishStateChange();
}

export function setAccountLastBackfillAt(
	database: DatabaseSync,
	accountEmail: string,
	lastBackfillAt: string
): void {
	database
		.prepare('UPDATE accounts SET last_backfill_at = ?, updated_at = ? WHERE email = ?')
		.run(lastBackfillAt, new Date().toISOString(), accountEmail);
	publishStateChange();
}

export function getEmailActionTarget(
	database: DatabaseSync,
	emailId: number
): { accountEmail: string; gmailId: string } | null {
	const row = database
		.prepare('SELECT account_email, gmail_id FROM emails WHERE id = ? AND deleted_at IS NULL')
		.get(emailId) as { account_email: string; gmail_id: string } | null;
	return row
		? { accountEmail: row.account_email, gmailId: row.gmail_id }
		: null;
}

function hashEmail(email: IncomingEmail): string {
	return createHash('sha256')
		.update(
			JSON.stringify({
				from: email.from ?? '',
				to: email.to ?? '',
				subject: email.subject ?? '',
				date: email.date ?? '',
				snippet: email.snippet ?? '',
				bodyText: email.bodyText ?? '',
				labels: email.labels ?? []
			})
		)
		.digest('hex');
}

export function upsertEmails(
	database: DatabaseSync,
	accountEmail: string,
	emails: IncomingEmail[]
): IncomingEmail[] {
	upsertAccount(database, { email: accountEmail });
	const now = new Date().toISOString();
	const needsClassification: IncomingEmail[] = [];
	const existing = database.prepare(
		'SELECT content_hash, classified_at FROM emails WHERE account_email = ? AND gmail_id = ?'
	);
	const insert = database.prepare(`
    INSERT INTO emails (
      account_email, gmail_id, thread_id, from_address, to_addresses, subject,
      message_date, snippet, body_text, body_html, body_truncated, labels_json, content_hash,
      first_seen_at, updated_at, deleted_at
    ) VALUES (
      $account, $gmailId, $threadId, $from, $to, $subject,
      $messageDate, $snippet, $bodyText, $bodyHtml, $bodyTruncated, $labels, $contentHash,
      $now, $now, NULL
    )
    ON CONFLICT(account_email, gmail_id) DO UPDATE SET
      thread_id = excluded.thread_id,
      from_address = excluded.from_address,
      to_addresses = excluded.to_addresses,
      subject = excluded.subject,
      message_date = excluded.message_date,
      snippet = excluded.snippet,
      body_text = excluded.body_text,
      body_html = excluded.body_html,
      body_truncated = excluded.body_truncated,
      labels_json = excluded.labels_json,
      content_hash = excluded.content_hash,
      category = CASE WHEN emails.content_hash = excluded.content_hash THEN emails.category ELSE NULL END,
      importance = CASE WHEN emails.content_hash = excluded.content_hash THEN emails.importance ELSE NULL END,
      classified_at = CASE WHEN emails.content_hash = excluded.content_hash THEN emails.classified_at ELSE NULL END,
      classification_error = CASE WHEN emails.content_hash = excluded.content_hash THEN emails.classification_error ELSE NULL END,
      archived_at = CASE
        WHEN instr(excluded.labels_json, '"INBOX"') > 0 THEN NULL
        WHEN emails.content_hash = excluded.content_hash THEN emails.archived_at
        ELSE NULL
      END,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `);

	withTransaction(database, () => {
		for (const email of emails) {
			const contentHash = hashEmail(email);
			const prior = existing.get(accountEmail, email.id) as
				| { content_hash: string; classified_at: string | null }
				| null;
			insert.run({
				$account: accountEmail,
				$gmailId: email.id,
				$threadId: email.threadId ?? null,
				$from: email.from ?? '',
				$to: email.to ?? '',
				$subject: email.subject ?? '(no subject)',
				$messageDate: email.date ?? null,
				$snippet: email.snippet ?? '',
				$bodyText: email.bodyText ?? '',
				$bodyHtml: email.bodyHtml ?? null,
				$bodyTruncated: email.bodyTruncated ? 1 : 0,
				$labels: JSON.stringify(email.labels ?? []),
				$contentHash: contentHash,
				$now: now
			});
			if (!prior?.classified_at || prior.content_hash !== contentHash) needsClassification.push(email);
		}
	});
	return needsClassification;
}

export function saveClassification(
	database: DatabaseSync,
	accountEmail: string,
	gmailId: string,
	classification: Classification
): void {
	if (!listCategories(database).some((category) => category.id === classification.category)) {
		throw new Error('The selected category no longer exists. Classify this message again.');
	}
	database
		.prepare(
			`UPDATE emails SET
        category = $category,
        importance = $importance,
		has_action_item = $hasActionItem,
		action_item_probability = $actionItemProbability,
		has_reminder = $hasReminder,
		reminder_probability = $reminderProbability,
        category_confidence = $categoryConfidence,
        importance_confidence = $importanceConfidence,
        category_probabilities_json = $categoryProbabilities,
        importance_probabilities_json = $importanceProbabilities,
        classification_model = $model,
        classification_error = NULL,
        classified_at = $now,
        updated_at = $now
      WHERE account_email = $account AND gmail_id = $gmailId`
		)
		.run({
			$category: classification.category,
			$importance: classification.importance,
			$hasActionItem: classification.hasActionItem ? 1 : 0,
			$actionItemProbability: classification.actionItemProbability,
			$hasReminder: classification.hasReminder ? 1 : 0,
			$reminderProbability: classification.reminderProbability,
			$categoryConfidence: classification.categoryConfidence,
			$importanceConfidence: classification.importanceConfidence,
			$categoryProbabilities: JSON.stringify(classification.categoryProbabilities),
			$importanceProbabilities: JSON.stringify(classification.importanceProbabilities),
			$model: classification.model,
			$now: new Date().toISOString(),
			$account: accountEmail,
			$gmailId: gmailId
		});
	publishStateChange();
}

export function saveClassificationError(
	database: DatabaseSync,
	accountEmail: string,
	gmailId: string,
	error: unknown
): void {
	database
		.prepare(
			`UPDATE emails SET classification_error = ?, updated_at = ?
       WHERE account_email = ? AND gmail_id = ?`
		)
		.run(
			error instanceof Error ? error.message : String(error),
			new Date().toISOString(),
			accountEmail,
			gmailId
		);
	publishStateChange();
}

export function markDeleted(database: DatabaseSync, accountEmail: string, gmailIds: string[]): void {
	if (gmailIds.length === 0) return;
	const statement = database.prepare(
		'UPDATE emails SET deleted_at = ?, updated_at = ? WHERE account_email = ? AND gmail_id = ?'
	);
	const now = new Date().toISOString();
	withTransaction(database, () => {
		for (const gmailId of gmailIds) statement.run(now, now, accountEmail, gmailId);
	});
}

export function markArchived(database: DatabaseSync, accountEmail: string, gmailIds: string[]): void {
	if (gmailIds.length === 0) return;
	const statement = database.prepare(
		'UPDATE emails SET archived_at = ?, updated_at = ? WHERE account_email = ? AND gmail_id = ?'
	);
	const now = new Date().toISOString();
	withTransaction(database, () => {
		for (const gmailId of gmailIds) statement.run(now, now, accountEmail, gmailId);
	});
}

export function listEmails(database: DatabaseSync, account?: string): StoredEmail[] {
	const where = account
		? 'WHERE deleted_at IS NULL AND account_email = $account'
		: 'WHERE deleted_at IS NULL';
	const statement = database.prepare(
		`SELECT emails.id, account_email, gmail_id, thread_id, from_address, to_addresses,
      subject, message_date, snippet, body_text, body_html, body_truncated, labels_json, category,
      importance, has_action_item, action_item_probability, has_reminder, reminder_probability,
      category_confidence, importance_confidence, classification_error, deleted_at
     FROM emails LEFT JOIN categories ON categories.id = emails.category ${where} AND archived_at IS NULL
     ORDER BY CASE (CASE WHEN categories.level = 'auto' THEN emails.importance ELSE categories.level END)
       WHEN 'important' THEN 0 WHEN 'useful' THEN 1 ELSE 2 END, message_date DESC, first_seen_at DESC`
	);
	const rows = (account ? statement.all({ $account: account }) : statement.all()) as Array<
		Record<string, unknown>
	>;

	return rows.map((row) => ({
		id: Number(row.id),
		accountEmail: String(row.account_email),
		gmailId: String(row.gmail_id),
		threadId: row.thread_id === null ? null : String(row.thread_id),
		fromAddress: String(row.from_address),
		toAddresses: String(row.to_addresses),
		subject: String(row.subject),
		messageDate: row.message_date === null ? null : String(row.message_date),
		snippet: String(row.snippet),
		bodyText: String(row.body_text),
		bodyHtml: row.body_html === null ? null : String(row.body_html),
		bodyTruncated: Boolean(row.body_truncated),
		labels: JSON.parse(String(row.labels_json)) as string[],
		category: row.category as StoredEmail['category'],
		importance: row.importance as StoredEmail['importance'],
		hasActionItem: row.has_action_item === null ? null : Boolean(row.has_action_item),
		actionItemProbability:
			row.action_item_probability === null ? null : Number(row.action_item_probability),
		hasReminder: row.has_reminder === null ? null : Boolean(row.has_reminder),
		reminderProbability:
			row.reminder_probability === null ? null : Number(row.reminder_probability),
		categoryConfidence: row.category_confidence === null ? null : Number(row.category_confidence),
		importanceConfidence:
			row.importance_confidence === null ? null : Number(row.importance_confidence),
		classificationError:
			row.classification_error === null ? null : String(row.classification_error),
		deletedAt: row.deleted_at === null ? null : String(row.deleted_at)
	}));
}

function withTransaction(database: DatabaseSync, operation: () => void): void {
	database.exec('BEGIN IMMEDIATE');
	try {
		operation();
		database.exec('COMMIT');
		publishStateChange();
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}
}

export function listCategories(database: DatabaseSync): Category[] {
	return database.prepare('SELECT id, name, description, level FROM categories ORDER BY rowid').all() as Category[];
}

export class CategoryValidationError extends Error {}

export function saveCategory(database: DatabaseSync, input: Omit<Category, 'id'> & { id?: string }): string {
	const name = input.name.trim();
	const description = input.description.trim();
	if (!name || !description) throw new CategoryValidationError('Enter a name and a description.');
	if (!['important', 'useful', 'other', 'auto'].includes(input.level)) throw new CategoryValidationError('Choose a category level.');
	const categories = listCategories(database);
	if (input.id && !categories.some((category) => category.id === input.id)) {
		throw new CategoryValidationError('This category no longer exists. Reload Settings.');
	}
	if (categories.some((category) => category.id !== input.id && category.name.toLowerCase() === name.toLowerCase())) {
		throw new CategoryValidationError('A category with this name already exists.');
	}
	const id = input.id ?? `category_${randomUUID().replaceAll('-', '')}`;
	database.prepare(`INSERT INTO categories (id, name, description, level) VALUES (?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, level = excluded.level`)
		.run(id, name, description, input.level);
	if (input.level === 'auto') {
		database.prepare('UPDATE emails SET classified_at = NULL WHERE category = ? AND importance IS NULL').run(id);
	}
	publishStateChange();
	return id;
}

export function deleteCategory(database: DatabaseSync, id: string): void {
	withTransaction(database, () => {
		database.prepare(`UPDATE emails SET category = NULL, category_confidence = NULL,
			category_probabilities_json = NULL, importance = NULL, importance_confidence = NULL,
			importance_probabilities_json = NULL, has_action_item = NULL,
			action_item_probability = NULL, has_reminder = NULL, reminder_probability = NULL,
			classified_at = NULL, classification_error = NULL
			WHERE category = ?`).run(id);
		database.prepare('DELETE FROM categories WHERE id = ?').run(id);
	});
}
