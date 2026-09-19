import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Classification, IncomingEmail, StoredEmail } from './types';

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
  body TEXT NOT NULL DEFAULT '',
  body_truncated INTEGER NOT NULL DEFAULT 0 CHECK (body_truncated IN (0, 1)),
  labels_json TEXT NOT NULL DEFAULT '[]',
  content_hash TEXT NOT NULL,
  category TEXT,
  useful INTEGER CHECK (useful IN (0, 1)),
  category_confidence REAL,
  usefulness_confidence REAL,
  category_probabilities_json TEXT,
  usefulness_probabilities_json TEXT,
  classification_model TEXT,
  classification_error TEXT,
  classified_at TEXT,
  deleted_at TEXT,
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
}

export function listAccounts(database: DatabaseSync): Array<{
	email: string;
	client: string;
	topic: string | null;
	subscription: string | null;
	historyId: string | null;
	enabled: boolean;
}> {
	const rows = database
		.prepare(
			'SELECT email, gog_client, topic, subscription, history_id, enabled FROM accounts ORDER BY email'
		)
		.all() as Array<Record<string, unknown>>;
	return rows.map((row) => ({
		email: String(row.email),
		client: String(row.gog_client),
		topic: row.topic === null ? null : String(row.topic),
		subscription: row.subscription === null ? null : String(row.subscription),
		historyId: row.history_id === null ? null : String(row.history_id),
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
				body: email.body ?? '',
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
      message_date, snippet, body, body_truncated, labels_json, content_hash,
      first_seen_at, updated_at, deleted_at
    ) VALUES (
      $account, $gmailId, $threadId, $from, $to, $subject,
      $messageDate, $snippet, $body, $bodyTruncated, $labels, $contentHash,
      $now, $now, NULL
    )
    ON CONFLICT(account_email, gmail_id) DO UPDATE SET
      thread_id = excluded.thread_id,
      from_address = excluded.from_address,
      to_addresses = excluded.to_addresses,
      subject = excluded.subject,
      message_date = excluded.message_date,
      snippet = excluded.snippet,
      body = excluded.body,
      body_truncated = excluded.body_truncated,
      labels_json = excluded.labels_json,
      content_hash = excluded.content_hash,
      category = CASE WHEN emails.content_hash = excluded.content_hash THEN emails.category ELSE NULL END,
      useful = CASE WHEN emails.content_hash = excluded.content_hash THEN emails.useful ELSE NULL END,
      classified_at = CASE WHEN emails.content_hash = excluded.content_hash THEN emails.classified_at ELSE NULL END,
      classification_error = CASE WHEN emails.content_hash = excluded.content_hash THEN emails.classification_error ELSE NULL END,
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
				$body: email.body ?? '',
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
	database
		.prepare(
			`UPDATE emails SET
        category = $category,
        useful = $useful,
        category_confidence = $categoryConfidence,
        usefulness_confidence = $usefulnessConfidence,
        category_probabilities_json = $categoryProbabilities,
        usefulness_probabilities_json = $usefulnessProbabilities,
        classification_model = $model,
        classification_error = NULL,
        classified_at = $now,
        updated_at = $now
      WHERE account_email = $account AND gmail_id = $gmailId`
		)
		.run({
			$category: classification.category,
			$useful: classification.useful ? 1 : 0,
			$categoryConfidence: classification.categoryConfidence,
			$usefulnessConfidence: classification.usefulnessConfidence,
			$categoryProbabilities: JSON.stringify(classification.categoryProbabilities),
			$usefulnessProbabilities: JSON.stringify(classification.usefulnessProbabilities),
			$model: classification.model,
			$now: new Date().toISOString(),
			$account: accountEmail,
			$gmailId: gmailId
		});
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

export function listEmails(database: DatabaseSync, account?: string): StoredEmail[] {
	const where = account
		? 'WHERE deleted_at IS NULL AND account_email = $account'
		: 'WHERE deleted_at IS NULL';
	const statement = database.prepare(
		`SELECT id, account_email, gmail_id, thread_id, from_address, to_addresses,
      subject, message_date, snippet, body, body_truncated, labels_json, category,
      useful, category_confidence, usefulness_confidence, classification_error, deleted_at
     FROM emails ${where}
     ORDER BY CASE WHEN useful = 1 THEN 0 ELSE 1 END, message_date DESC, first_seen_at DESC`
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
		body: String(row.body),
		bodyTruncated: Boolean(row.body_truncated),
		labels: JSON.parse(String(row.labels_json)) as string[],
		category: row.category as StoredEmail['category'],
		useful: row.useful === null ? null : Boolean(row.useful),
		categoryConfidence: row.category_confidence === null ? null : Number(row.category_confidence),
		usefulnessConfidence:
			row.usefulness_confidence === null ? null : Number(row.usefulness_confidence),
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
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}
}
