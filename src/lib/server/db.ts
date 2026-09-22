import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type {
	Category,
	Classification,
	EmailExtraction,
	IncomingEmail,
	StoredEmail,
	SyncedCalendar,
	SyncedCalendarEvent,
	SyncedContact
} from './types';

import { publishStateChange } from './state-events';
import { defaultCategories } from './default-categories';

const defaultPath = resolve(process.env.DATABASE_PATH ?? 'data/email-check.sqlite');
let sharedDatabase: DatabaseSync | undefined;

const schema = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  email TEXT PRIMARY KEY,
  google_refresh_token TEXT,
  topic TEXT,
  subscription TEXT,
  history_id TEXT,
  last_backfill_at TEXT,
  contacts_synced_at TEXT,
  calendar_synced_at TEXT,
  contacts_sync_token TEXT,
  calendar_list_sync_token TEXT,
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
  action_items_json TEXT,
  reminders_json TEXT,
  extraction_model TEXT,
  extraction_error TEXT,
  extracted_at TEXT,
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

CREATE TABLE IF NOT EXISTS contacts (
  account_email TEXT NOT NULL REFERENCES accounts(email) ON DELETE CASCADE,
  resource_name TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  emails_json TEXT NOT NULL DEFAULT '[]',
  phones_json TEXT NOT NULL DEFAULT '[]',
  organization TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_email, resource_name)
);

CREATE INDEX IF NOT EXISTS idx_contacts_name
ON contacts(display_name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS calendars (
  account_email TEXT NOT NULL REFERENCES accounts(email) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  time_zone TEXT,
  background_color TEXT,
  selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),
  sync_token TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_email, calendar_id)
);

CREATE TABLE IF NOT EXISTS calendar_events (
  account_email TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  description TEXT,
  location TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
  status TEXT NOT NULL DEFAULT '',
  html_link TEXT,
  organizer TEXT,
  attendees_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_email, calendar_id, event_id),
  FOREIGN KEY (account_email, calendar_id) REFERENCES calendars(account_email, calendar_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_start
ON calendar_events(start_at, end_at);

CREATE TABLE IF NOT EXISTS google_sync_progress (
  account_email TEXT NOT NULL REFERENCES accounts(email) ON DELETE CASCADE,
  sync_type TEXT NOT NULL CHECK (sync_type IN ('contacts', 'calendar')),
  sync_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  page_token TEXT,
  calendar_id TEXT,
  next_sync_token TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_email, sync_type)
);

CREATE TABLE IF NOT EXISTS google_sync_contacts (
  account_email TEXT NOT NULL,
  sync_id TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  emails_json TEXT NOT NULL DEFAULT '[]',
  phones_json TEXT NOT NULL DEFAULT '[]',
  organization TEXT,
  PRIMARY KEY (account_email, sync_id, resource_name)
);

CREATE TABLE IF NOT EXISTS google_sync_calendars (
  account_email TEXT NOT NULL,
  sync_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  time_zone TEXT,
  background_color TEXT,
  selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),
  sync_token TEXT,
  events_loaded INTEGER NOT NULL DEFAULT 0 CHECK (events_loaded IN (0, 1)),
  PRIMARY KEY (account_email, sync_id, calendar_id)
);

CREATE TABLE IF NOT EXISTS google_sync_calendar_events (
  account_email TEXT NOT NULL,
  sync_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  description TEXT,
  location TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
  status TEXT NOT NULL DEFAULT '',
  html_link TEXT,
  organizer TEXT,
  attendees_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (account_email, sync_id, calendar_id, event_id)
);
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
	if (!accountColumns.some((column) => column.name === 'contacts_synced_at')) {
		database.exec('ALTER TABLE accounts ADD COLUMN contacts_synced_at TEXT');
	}
	if (!accountColumns.some((column) => column.name === 'calendar_synced_at')) {
		database.exec('ALTER TABLE accounts ADD COLUMN calendar_synced_at TEXT');
	}
	if (!accountColumns.some((column) => column.name === 'google_refresh_token')) {
		database.exec('ALTER TABLE accounts ADD COLUMN google_refresh_token TEXT');
	}
	if (!accountColumns.some((column) => column.name === 'contacts_sync_token')) {
		database.exec('ALTER TABLE accounts ADD COLUMN contacts_sync_token TEXT');
	}
	if (!accountColumns.some((column) => column.name === 'calendar_list_sync_token')) {
		database.exec('ALTER TABLE accounts ADD COLUMN calendar_list_sync_token TEXT');
	}
	const calendarColumns = database.prepare('PRAGMA table_info(calendars)').all() as Array<{ name: string }>;
	if (!calendarColumns.some((column) => column.name === 'sync_token')) {
		database.exec('ALTER TABLE calendars ADD COLUMN sync_token TEXT');
	}
	const progressColumns = database.prepare('PRAGMA table_info(google_sync_progress)').all() as Array<{ name: string }>;
	if (!progressColumns.some((column) => column.name === 'next_sync_token')) {
		database.exec('ALTER TABLE google_sync_progress ADD COLUMN next_sync_token TEXT');
	}
	const stagedCalendarColumns = database.prepare('PRAGMA table_info(google_sync_calendars)').all() as Array<{ name: string }>;
	if (!stagedCalendarColumns.some((column) => column.name === 'sync_token')) {
		database.exec('ALTER TABLE google_sync_calendars ADD COLUMN sync_token TEXT');
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
		if (!emailColumns.some((column) => column.name === 'action_items_json')) {
			database.exec(`ALTER TABLE emails ADD COLUMN action_items_json TEXT;
				ALTER TABLE emails ADD COLUMN reminders_json TEXT;
				ALTER TABLE emails ADD COLUMN extraction_model TEXT;
				ALTER TABLE emails ADD COLUMN extraction_error TEXT;
				ALTER TABLE emails ADD COLUMN extracted_at TEXT;`);
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
	account: { email: string; refreshToken?: string; topic?: string | null; subscription?: string | null }
): void {
	const now = new Date().toISOString();
	database
		.prepare(
			`INSERT INTO accounts (email, google_refresh_token, topic, subscription, created_at, updated_at)
			 VALUES ($email, $refreshToken, $topic, $subscription, $now, $now)
			 ON CONFLICT(email) DO UPDATE SET
			   google_refresh_token = COALESCE(excluded.google_refresh_token, accounts.google_refresh_token),
         topic = COALESCE(excluded.topic, accounts.topic),
         subscription = COALESCE(excluded.subscription, accounts.subscription),
         updated_at = excluded.updated_at`
		)
		.run({
			$email: account.email,
			$refreshToken: account.refreshToken ?? null,
			$topic: account.topic ?? null,
			$subscription: account.subscription ?? null,
			$now: now
		});
	publishStateChange();
}

export function listAccounts(database: DatabaseSync): Array<{
	email: string;
	refreshToken: string | null;
	topic: string | null;
	subscription: string | null;
	historyId: string | null;
	lastBackfillAt: string | null;
	contactsSyncedAt: string | null;
	calendarSyncedAt: string | null;
	enabled: boolean;
}> {
	const rows = database
		.prepare(
			'SELECT email, google_refresh_token, topic, subscription, history_id, last_backfill_at, contacts_synced_at, calendar_synced_at, enabled FROM accounts ORDER BY email'
		)
		.all() as Array<Record<string, unknown>>;
	return rows.map((row) => ({
		email: String(row.email),
		refreshToken: row.google_refresh_token === null ? null : String(row.google_refresh_token),
		topic: row.topic === null ? null : String(row.topic),
		subscription: row.subscription === null ? null : String(row.subscription),
		historyId: row.history_id === null ? null : String(row.history_id),
		lastBackfillAt: row.last_backfill_at === null ? null : String(row.last_backfill_at),
		contactsSyncedAt: row.contacts_synced_at === null ? null : String(row.contacts_synced_at),
		calendarSyncedAt: row.calendar_synced_at === null ? null : String(row.calendar_synced_at),
		enabled: Boolean(row.enabled)
	}));
}

export type GoogleSyncType = 'contacts' | 'calendar';
export type GoogleSyncProgress = {
	accountEmail: string;
	syncType: GoogleSyncType;
	syncId: string;
	phase: string;
	pageToken: string | null;
	calendarId: string | null;
	nextSyncToken: string | null;
	startedAt: string;
};

function readGoogleSyncProgress(row: Record<string, unknown>): GoogleSyncProgress {
	return {
		accountEmail: String(row.account_email),
		syncType: String(row.sync_type) as GoogleSyncType,
		syncId: String(row.sync_id),
		phase: String(row.phase),
		pageToken: row.page_token === null ? null : String(row.page_token),
		calendarId: row.calendar_id === null ? null : String(row.calendar_id),
		nextSyncToken: row.next_sync_token === null ? null : String(row.next_sync_token),
		startedAt: String(row.started_at)
	};
}

export function getGoogleSyncProgress(
	database: DatabaseSync,
	accountEmail: string,
	syncType: GoogleSyncType
): GoogleSyncProgress | null {
	const row = database.prepare('SELECT * FROM google_sync_progress WHERE account_email = ? AND sync_type = ?')
		.get(accountEmail, syncType) as Record<string, unknown> | null;
	return row ? readGoogleSyncProgress(row) : null;
}

export function startGoogleSync(
	database: DatabaseSync,
	accountEmail: string,
	syncType: GoogleSyncType
): GoogleSyncProgress {
	const existing = getGoogleSyncProgress(database, accountEmail, syncType);
	if (existing) return existing;
	const syncId = randomUUID();
	const startedAt = new Date().toISOString();
	const phase = syncType === 'contacts' ? 'contacts' : 'calendarList';
	withTransaction(database, () => {
		if (syncType === 'contacts') {
			database.prepare('DELETE FROM google_sync_contacts WHERE account_email = ?').run(accountEmail);
		} else {
			database.prepare('DELETE FROM google_sync_calendars WHERE account_email = ?').run(accountEmail);
			database.prepare('DELETE FROM google_sync_calendar_events WHERE account_email = ?').run(accountEmail);
		}
		database.prepare(`INSERT INTO google_sync_progress
		(account_email, sync_type, sync_id, phase, page_token, calendar_id, next_sync_token, started_at, updated_at)
		VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`)
		.run(accountEmail, syncType, syncId, phase, startedAt, startedAt);
	});
	return { accountEmail, syncType, syncId, phase, pageToken: null, calendarId: null, nextSyncToken: null, startedAt };
}

function countRows(database: DatabaseSync, table: string, accountEmail: string, syncId?: string): number {
	const row = syncId
		? database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE account_email = ? AND sync_id = ?`).get(accountEmail, syncId)
		: database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE account_email = ?`).get(accountEmail);
	return Number((row as { count: number }).count);
}

export function getGoogleSyncCounts(database: DatabaseSync, accountEmail: string): {
	contacts: number;
	calendars: number;
	events: number;
} {
	const contactProgress = getGoogleSyncProgress(database, accountEmail, 'contacts');
	const calendarProgress = getGoogleSyncProgress(database, accountEmail, 'calendar');
	return {
		contacts: contactProgress
			? countRows(database, 'google_sync_contacts', accountEmail, contactProgress.syncId)
			: countRows(database, 'contacts', accountEmail),
		calendars: calendarProgress
			? countRows(database, 'google_sync_calendars', accountEmail, calendarProgress.syncId)
			: countRows(database, 'calendars', accountEmail),
		events: calendarProgress
			? countRows(database, 'google_sync_calendar_events', accountEmail, calendarProgress.syncId)
			: countRows(database, 'calendar_events', accountEmail)
	};
}

export function getGoogleSyncState(database: DatabaseSync, accountEmail: string): {
	contactsSyncToken: string | null;
	calendarListSyncToken: string | null;
	calendarEventSyncTokens: Map<string, string | null>;
} {
	const account = database.prepare(`SELECT contacts_sync_token, calendar_list_sync_token
		FROM accounts WHERE email = ?`).get(accountEmail) as Record<string, unknown> | null;
	if (!account) throw new Error(`No account is configured for ${accountEmail}.`);
	const calendars = database.prepare('SELECT calendar_id, sync_token FROM calendars WHERE account_email = ?')
		.all(accountEmail) as Array<Record<string, unknown>>;
	return {
		contactsSyncToken: account.contacts_sync_token === null ? null : String(account.contacts_sync_token),
		calendarListSyncToken: account.calendar_list_sync_token === null ? null : String(account.calendar_list_sync_token),
		calendarEventSyncTokens: new Map(calendars.map((row) => [
			String(row.calendar_id), row.sync_token === null ? null : String(row.sync_token)
		]))
	};
}

export function resetGoogleSyncState(database: DatabaseSync, accountEmail: string): void {
	withTransaction(database, () => {
		database.prepare('DELETE FROM google_sync_contacts WHERE account_email = ?').run(accountEmail);
		database.prepare('DELETE FROM google_sync_calendar_events WHERE account_email = ?').run(accountEmail);
		database.prepare('DELETE FROM google_sync_calendars WHERE account_email = ?').run(accountEmail);
		database.prepare('DELETE FROM google_sync_progress WHERE account_email = ?').run(accountEmail);
		database.prepare(`UPDATE accounts SET contacts_sync_token = NULL, calendar_list_sync_token = NULL,
			updated_at = ? WHERE email = ?`).run(new Date().toISOString(), accountEmail);
		database.prepare('UPDATE calendars SET sync_token = NULL WHERE account_email = ?').run(accountEmail);
	});
}

export function applyContactsIncrementalSync(
	database: DatabaseSync,
	accountEmail: string,
	contacts: Omit<SyncedContact, 'accountEmail'>[],
	deletedResourceNames: string[],
	nextSyncToken: string
): void {
	const syncedAt = new Date().toISOString();
	withTransaction(database, () => {
		const upsert = database.prepare(`INSERT INTO contacts
			(account_email, resource_name, display_name, emails_json, phones_json, organization, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(account_email, resource_name) DO UPDATE SET display_name = excluded.display_name,
				emails_json = excluded.emails_json, phones_json = excluded.phones_json,
				organization = excluded.organization, updated_at = excluded.updated_at`);
		for (const contact of contacts) upsert.run(accountEmail, contact.resourceName, contact.displayName,
			JSON.stringify(contact.emails), JSON.stringify(contact.phones), contact.organization, syncedAt);
		const remove = database.prepare('DELETE FROM contacts WHERE account_email = ? AND resource_name = ?');
		for (const resourceName of deletedResourceNames) remove.run(accountEmail, resourceName);
		database.prepare(`UPDATE accounts SET contacts_sync_token = ?, contacts_synced_at = ?, updated_at = ?
			WHERE email = ?`).run(nextSyncToken, syncedAt, syncedAt, accountEmail);
	});
}

export function applyCalendarListIncrementalSync(
	database: DatabaseSync,
	accountEmail: string,
	calendars: Omit<SyncedCalendar, 'accountEmail'>[],
	deletedCalendarIds: string[],
	nextSyncToken: string
): void {
	const syncedAt = new Date().toISOString();
	withTransaction(database, () => {
		const remove = database.prepare('DELETE FROM calendars WHERE account_email = ? AND calendar_id = ?');
		for (const calendarId of deletedCalendarIds) remove.run(accountEmail, calendarId);
		const upsert = database.prepare(`INSERT INTO calendars
			(account_email, calendar_id, summary, time_zone, background_color, selected, sync_token, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
			ON CONFLICT(account_email, calendar_id) DO UPDATE SET summary = excluded.summary,
				time_zone = excluded.time_zone, background_color = excluded.background_color,
				selected = excluded.selected, updated_at = excluded.updated_at`);
		for (const calendar of calendars) upsert.run(accountEmail, calendar.calendarId, calendar.summary,
			calendar.timeZone, calendar.backgroundColor, calendar.selected ? 1 : 0, syncedAt);
		database.prepare(`UPDATE accounts SET calendar_list_sync_token = ?, calendar_synced_at = ?, updated_at = ?
			WHERE email = ?`).run(nextSyncToken, syncedAt, syncedAt, accountEmail);
	});
}

export function applyCalendarEventsIncrementalSync(
	database: DatabaseSync,
	accountEmail: string,
	calendarId: string,
	events: Omit<SyncedCalendarEvent, 'accountEmail'>[],
	deletedEventIds: string[],
	nextSyncToken: string,
	replace: boolean
): void {
	const syncedAt = new Date().toISOString();
	withTransaction(database, () => {
		if (replace) database.prepare('DELETE FROM calendar_events WHERE account_email = ? AND calendar_id = ?').run(accountEmail, calendarId);
		const upsert = database.prepare(`INSERT INTO calendar_events
			(account_email, calendar_id, event_id, summary, description, location, start_at, end_at,
			 all_day, status, html_link, organizer, attendees_json, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(account_email, calendar_id, event_id) DO UPDATE SET summary = excluded.summary,
				description = excluded.description, location = excluded.location, start_at = excluded.start_at,
				end_at = excluded.end_at, all_day = excluded.all_day, status = excluded.status,
				html_link = excluded.html_link, organizer = excluded.organizer,
				attendees_json = excluded.attendees_json, updated_at = excluded.updated_at`);
		for (const event of events) upsert.run(accountEmail, calendarId, event.eventId, event.summary,
			event.description, event.location, event.startAt, event.endAt, event.allDay ? 1 : 0,
			event.status, event.htmlLink, event.organizer, JSON.stringify(event.attendees), syncedAt);
		const remove = database.prepare(`DELETE FROM calendar_events
			WHERE account_email = ? AND calendar_id = ? AND event_id = ?`);
		for (const eventId of deletedEventIds) remove.run(accountEmail, calendarId, eventId);
		database.prepare(`UPDATE calendars SET sync_token = ?, updated_at = ?
			WHERE account_email = ? AND calendar_id = ?`).run(nextSyncToken, syncedAt, accountEmail, calendarId);
		database.prepare('UPDATE accounts SET calendar_synced_at = ?, updated_at = ? WHERE email = ?')
			.run(syncedAt, syncedAt, accountEmail);
	});
}

export function saveContactsSyncPage(
	database: DatabaseSync,
	progress: GoogleSyncProgress,
	contacts: Omit<SyncedContact, 'accountEmail'>[],
	nextPageToken: string | undefined,
	nextSyncToken?: string
): boolean {
	const updatedAt = new Date().toISOString();
	let complete = false;
	withTransaction(database, () => {
		const insert = database.prepare(`INSERT INTO google_sync_contacts
			(account_email, sync_id, resource_name, display_name, emails_json, phones_json, organization)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(account_email, sync_id, resource_name) DO UPDATE SET
				display_name = excluded.display_name, emails_json = excluded.emails_json,
				phones_json = excluded.phones_json, organization = excluded.organization`);
		for (const contact of contacts) {
			insert.run(progress.accountEmail, progress.syncId, contact.resourceName, contact.displayName,
				JSON.stringify(contact.emails), JSON.stringify(contact.phones), contact.organization);
		}
		if (nextPageToken) {
			database.prepare('UPDATE google_sync_progress SET page_token = ?, updated_at = ? WHERE account_email = ? AND sync_type = ?')
				.run(nextPageToken, updatedAt, progress.accountEmail, 'contacts');
			return;
		}
		if (!nextSyncToken) throw new Error('Google Contacts full sync did not return a sync token.');
		database.prepare('UPDATE google_sync_progress SET phase = ?, page_token = NULL, next_sync_token = ?, updated_at = ? WHERE account_email = ? AND sync_type = ?')
			.run('complete', nextSyncToken, updatedAt, progress.accountEmail, 'contacts');
		complete = true;
	});
	return complete;
}

function finishCalendarSync(database: DatabaseSync, progress: GoogleSyncProgress, updatedAt: string): void {
	database.prepare('UPDATE google_sync_progress SET phase = ?, page_token = NULL, calendar_id = NULL, updated_at = ? WHERE account_email = ? AND sync_type = ?')
		.run('complete', updatedAt, progress.accountEmail, 'calendar');
}

export function finalizeGoogleSync(database: DatabaseSync, accountEmail: string): void {
	const contacts = getGoogleSyncProgress(database, accountEmail, 'contacts');
	const calendar = getGoogleSyncProgress(database, accountEmail, 'calendar');
	if (!contacts || contacts.phase !== 'complete' || !calendar || calendar.phase !== 'complete') {
		throw new Error('Google sync cannot be finalized before Contacts and Calendar downloads are complete.');
	}
	const syncedAt = new Date().toISOString();
	withTransaction(database, () => {
		database.prepare('DELETE FROM contacts WHERE account_email = ?').run(accountEmail);
		database.prepare(`INSERT INTO contacts
			(account_email, resource_name, display_name, emails_json, phones_json, organization, updated_at)
			SELECT account_email, resource_name, display_name, emails_json, phones_json, organization, ?
			FROM google_sync_contacts WHERE account_email = ? AND sync_id = ?`).run(syncedAt, accountEmail, contacts.syncId);
		database.prepare('DELETE FROM calendar_events WHERE account_email = ?').run(accountEmail);
		database.prepare('DELETE FROM calendars WHERE account_email = ?').run(accountEmail);
		database.prepare(`INSERT INTO calendars
			(account_email, calendar_id, summary, time_zone, background_color, selected, sync_token, updated_at)
			SELECT account_email, calendar_id, summary, time_zone, background_color, selected, sync_token, ?
			FROM google_sync_calendars WHERE account_email = ? AND sync_id = ?`).run(syncedAt, accountEmail, calendar.syncId);
		database.prepare(`INSERT INTO calendar_events
			(account_email, calendar_id, event_id, summary, description, location, start_at, end_at,
			 all_day, status, html_link, organizer, attendees_json, updated_at)
			SELECT account_email, calendar_id, event_id, summary, description, location, start_at, end_at,
			 all_day, status, html_link, organizer, attendees_json, ?
			FROM google_sync_calendar_events WHERE account_email = ? AND sync_id = ?`).run(syncedAt, accountEmail, calendar.syncId);
		database.prepare(`UPDATE accounts SET contacts_synced_at = ?, calendar_synced_at = ?,
			contacts_sync_token = ?, calendar_list_sync_token = ?, updated_at = ? WHERE email = ?`)
			.run(syncedAt, syncedAt, contacts.nextSyncToken, calendar.nextSyncToken, syncedAt, accountEmail);
		database.prepare('DELETE FROM google_sync_contacts WHERE account_email = ? AND sync_id = ?').run(accountEmail, contacts.syncId);
		database.prepare('DELETE FROM google_sync_calendars WHERE account_email = ? AND sync_id = ?').run(accountEmail, calendar.syncId);
		database.prepare('DELETE FROM google_sync_calendar_events WHERE account_email = ? AND sync_id = ?').run(accountEmail, calendar.syncId);
		database.prepare('DELETE FROM google_sync_progress WHERE account_email = ?').run(accountEmail);
});
}

export function saveCalendarListSyncPage(
	database: DatabaseSync,
	progress: GoogleSyncProgress,
	calendars: Omit<SyncedCalendar, 'accountEmail'>[],
	nextPageToken: string | undefined,
	nextSyncToken?: string
): GoogleSyncProgress | null {
	const updatedAt = new Date().toISOString();
	let nextProgress: GoogleSyncProgress | null = null;
	withTransaction(database, () => {
		const insert = database.prepare(`INSERT INTO google_sync_calendars
			(account_email, sync_id, calendar_id, summary, time_zone, background_color, selected)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(account_email, sync_id, calendar_id) DO UPDATE SET
				summary = excluded.summary, time_zone = excluded.time_zone,
				background_color = excluded.background_color, selected = excluded.selected`);
		for (const calendar of calendars) {
			insert.run(progress.accountEmail, progress.syncId, calendar.calendarId, calendar.summary,
				calendar.timeZone, calendar.backgroundColor, calendar.selected ? 1 : 0);
		}
		if (nextPageToken) {
			database.prepare('UPDATE google_sync_progress SET page_token = ?, updated_at = ? WHERE account_email = ? AND sync_type = ?')
				.run(nextPageToken, updatedAt, progress.accountEmail, 'calendar');
			nextProgress = { ...progress, pageToken: nextPageToken };
			return;
		}
		if (!nextSyncToken) throw new Error('Google Calendar list full sync did not return a sync token.');
		database.prepare('UPDATE google_sync_progress SET next_sync_token = ?, updated_at = ? WHERE account_email = ? AND sync_type = ?')
			.run(nextSyncToken, updatedAt, progress.accountEmail, 'calendar');
		const first = database.prepare(`SELECT calendar_id FROM google_sync_calendars
			WHERE account_email = ? AND sync_id = ? ORDER BY calendar_id LIMIT 1`).get(progress.accountEmail, progress.syncId) as { calendar_id: string } | null;
		if (!first) {
			finishCalendarSync(database, progress, updatedAt);
			return;
		}
		database.prepare('UPDATE google_sync_progress SET phase = ?, page_token = NULL, calendar_id = ?, updated_at = ? WHERE account_email = ? AND sync_type = ?')
			.run('calendarEvents', first.calendar_id, updatedAt, progress.accountEmail, 'calendar');
		nextProgress = { ...progress, phase: 'calendarEvents', pageToken: null, calendarId: first.calendar_id, nextSyncToken };
	});
	return nextProgress;
}

export function saveCalendarEventsSyncPage(
	database: DatabaseSync,
	progress: GoogleSyncProgress,
	events: Omit<SyncedCalendarEvent, 'accountEmail'>[],
	nextPageToken: string | undefined,
	nextSyncToken?: string
): GoogleSyncProgress | null {
	if (!progress.calendarId) throw new Error('Calendar event sync progress is missing its calendar id.');
	const updatedAt = new Date().toISOString();
	let nextProgress: GoogleSyncProgress | null = null;
	withTransaction(database, () => {
		const insert = database.prepare(`INSERT INTO google_sync_calendar_events
			(account_email, sync_id, calendar_id, event_id, summary, description, location, start_at, end_at,
			 all_day, status, html_link, organizer, attendees_json)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(account_email, sync_id, calendar_id, event_id) DO UPDATE SET
				summary = excluded.summary, description = excluded.description, location = excluded.location,
				start_at = excluded.start_at, end_at = excluded.end_at, all_day = excluded.all_day,
				status = excluded.status, html_link = excluded.html_link, organizer = excluded.organizer,
				attendees_json = excluded.attendees_json`);
		for (const event of events) {
			insert.run(progress.accountEmail, progress.syncId, event.calendarId, event.eventId, event.summary,
				event.description, event.location, event.startAt, event.endAt, event.allDay ? 1 : 0,
				event.status, event.htmlLink, event.organizer, JSON.stringify(event.attendees));
		}
		if (nextPageToken) {
			database.prepare('UPDATE google_sync_progress SET page_token = ?, updated_at = ? WHERE account_email = ? AND sync_type = ?')
				.run(nextPageToken, updatedAt, progress.accountEmail, 'calendar');
			nextProgress = { ...progress, pageToken: nextPageToken };
			return;
		}
		if (!nextSyncToken) throw new Error('Google Calendar event full sync did not return a sync token.');
		database.prepare('UPDATE google_sync_calendars SET events_loaded = 1, sync_token = ? WHERE account_email = ? AND sync_id = ? AND calendar_id = ?')
			.run(nextSyncToken, progress.accountEmail, progress.syncId, progress.calendarId);
		const next = database.prepare(`SELECT calendar_id FROM google_sync_calendars
			WHERE account_email = ? AND sync_id = ? AND events_loaded = 0 ORDER BY calendar_id LIMIT 1`)
			.get(progress.accountEmail, progress.syncId) as { calendar_id: string } | null;
		if (!next) {
			finishCalendarSync(database, progress, updatedAt);
			return;
		}
		database.prepare('UPDATE google_sync_progress SET page_token = NULL, calendar_id = ?, updated_at = ? WHERE account_email = ? AND sync_type = ?')
			.run(next.calendar_id, updatedAt, progress.accountEmail, 'calendar');
		nextProgress = { ...progress, pageToken: null, calendarId: next.calendar_id };
	});
	return nextProgress;
}

export function replaceContacts(
	database: DatabaseSync,
	accountEmail: string,
	contacts: Omit<SyncedContact, 'accountEmail'>[],
	syncedAt = new Date().toISOString()
): void {
	const insert = database.prepare(`INSERT INTO contacts
		(account_email, resource_name, display_name, emails_json, phones_json, organization, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`);
	withTransaction(database, () => {
		database.prepare('DELETE FROM contacts WHERE account_email = ?').run(accountEmail);
		for (const contact of contacts) {
			insert.run(accountEmail, contact.resourceName, contact.displayName, JSON.stringify(contact.emails),
				JSON.stringify(contact.phones), contact.organization, syncedAt);
		}
		database.prepare('UPDATE accounts SET contacts_synced_at = ?, updated_at = ? WHERE email = ?')
			.run(syncedAt, syncedAt, accountEmail);
	});
}

export function listContacts(database: DatabaseSync, account?: string): SyncedContact[] {
	const rows = (account
		? database.prepare('SELECT * FROM contacts WHERE account_email = ? ORDER BY display_name COLLATE NOCASE').all(account)
		: database.prepare('SELECT * FROM contacts ORDER BY display_name COLLATE NOCASE, account_email').all()
	) as Array<Record<string, unknown>>;
	return rows.map((row) => ({
		accountEmail: String(row.account_email),
		resourceName: String(row.resource_name),
		displayName: String(row.display_name),
		emails: JSON.parse(String(row.emails_json)) as string[],
		phones: JSON.parse(String(row.phones_json)) as string[],
		organization: row.organization === null ? null : String(row.organization)
	}));
}

export function replaceCalendars(
	database: DatabaseSync,
	accountEmail: string,
	calendars: Omit<SyncedCalendar, 'accountEmail'>[],
	events: Omit<SyncedCalendarEvent, 'accountEmail'>[],
	syncedAt = new Date().toISOString()
): void {
	const insertCalendar = database.prepare(`INSERT INTO calendars
		(account_email, calendar_id, summary, time_zone, background_color, selected, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`);
	const insertEvent = database.prepare(`INSERT INTO calendar_events
		(account_email, calendar_id, event_id, summary, description, location, start_at, end_at,
		 all_day, status, html_link, organizer, attendees_json, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
	withTransaction(database, () => {
		database.prepare('DELETE FROM calendars WHERE account_email = ?').run(accountEmail);
		for (const calendar of calendars) {
			insertCalendar.run(accountEmail, calendar.calendarId, calendar.summary, calendar.timeZone,
				calendar.backgroundColor, calendar.selected ? 1 : 0, syncedAt);
		}
		for (const event of events) {
			insertEvent.run(accountEmail, event.calendarId, event.eventId, event.summary, event.description,
				event.location, event.startAt, event.endAt, event.allDay ? 1 : 0, event.status,
				event.htmlLink, event.organizer, JSON.stringify(event.attendees), syncedAt);
		}
		database.prepare('UPDATE accounts SET calendar_synced_at = ?, updated_at = ? WHERE email = ?')
			.run(syncedAt, syncedAt, accountEmail);
	});
}

export function listCalendars(database: DatabaseSync, account?: string): SyncedCalendar[] {
	const rows = (account
		? database.prepare('SELECT * FROM calendars WHERE account_email = ? ORDER BY summary COLLATE NOCASE').all(account)
		: database.prepare('SELECT * FROM calendars ORDER BY summary COLLATE NOCASE, account_email').all()
	) as Array<Record<string, unknown>>;
	return rows.map((row) => ({
		accountEmail: String(row.account_email), calendarId: String(row.calendar_id), summary: String(row.summary),
		timeZone: row.time_zone === null ? null : String(row.time_zone),
		backgroundColor: row.background_color === null ? null : String(row.background_color), selected: Boolean(row.selected)
	}));
}

export function listCalendarEvents(database: DatabaseSync, account?: string): SyncedCalendarEvent[] {
	const rows = (account
		? database.prepare('SELECT * FROM calendar_events WHERE account_email = ? ORDER BY start_at, summary COLLATE NOCASE').all(account)
		: database.prepare('SELECT * FROM calendar_events ORDER BY start_at, summary COLLATE NOCASE').all()
	) as Array<Record<string, unknown>>;
	return rows.map((row) => ({
		accountEmail: String(row.account_email), calendarId: String(row.calendar_id), eventId: String(row.event_id),
		summary: String(row.summary), description: row.description === null ? null : String(row.description),
		location: row.location === null ? null : String(row.location), startAt: String(row.start_at), endAt: String(row.end_at),
		allDay: Boolean(row.all_day), status: String(row.status),
		htmlLink: row.html_link === null ? null : String(row.html_link),
		organizer: row.organizer === null ? null : String(row.organizer),
		attendees: JSON.parse(String(row.attendees_json)) as string[]
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
      has_action_item = CASE WHEN emails.content_hash = excluded.content_hash THEN emails.has_action_item ELSE NULL END,
      action_item_probability = CASE WHEN emails.content_hash = excluded.content_hash THEN emails.action_item_probability ELSE NULL END,
      has_reminder = CASE WHEN emails.content_hash = excluded.content_hash THEN emails.has_reminder ELSE NULL END,
      reminder_probability = CASE WHEN emails.content_hash = excluded.content_hash THEN emails.reminder_probability ELSE NULL END,
      action_items_json = CASE WHEN emails.content_hash = excluded.content_hash THEN emails.action_items_json ELSE NULL END,
      reminders_json = CASE WHEN emails.content_hash = excluded.content_hash THEN emails.reminders_json ELSE NULL END,
      extraction_model = CASE WHEN emails.content_hash = excluded.content_hash THEN emails.extraction_model ELSE NULL END,
      extraction_error = CASE WHEN emails.content_hash = excluded.content_hash THEN emails.extraction_error ELSE NULL END,
      extracted_at = CASE WHEN emails.content_hash = excluded.content_hash THEN emails.extracted_at ELSE NULL END,
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
		action_items_json = NULL,
		reminders_json = NULL,
		extraction_model = NULL,
		extraction_error = NULL,
		extracted_at = NULL,
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

export function saveEmailExtraction(
	database: DatabaseSync,
	accountEmail: string,
	gmailId: string,
	extraction: EmailExtraction
): void {
	database.prepare(`UPDATE emails SET
		action_items_json = $actionItems,
		reminders_json = $reminders,
		extraction_model = $model,
		extraction_error = NULL,
		extracted_at = $now,
		updated_at = $now
		WHERE account_email = $account AND gmail_id = $gmailId`)
		.run({
			$actionItems: JSON.stringify(extraction.actionItems),
			$reminders: JSON.stringify(extraction.reminders),
			$model: extraction.model,
			$now: new Date().toISOString(),
			$account: accountEmail,
			$gmailId: gmailId
		});
	publishStateChange();
}

export function saveEmailExtractionError(
	database: DatabaseSync,
	accountEmail: string,
	gmailId: string,
	error: unknown
): void {
	database.prepare(`UPDATE emails SET extraction_error = ?, updated_at = ?
		WHERE account_email = ? AND gmail_id = ?`)
		.run(
			error instanceof Error ? error.message : String(error),
			new Date().toISOString(),
			accountEmail,
			gmailId
		);
	publishStateChange();
}

export function listEmailsNeedingExtraction(
	database: DatabaseSync,
	accountEmail: string
): Array<{
	email: IncomingEmail;
	targets: { actionItems: boolean; reminders: boolean };
}> {
	const rows = database.prepare(`SELECT gmail_id, thread_id, from_address, to_addresses, subject,
		message_date, snippet, body_text, body_html, body_truncated, labels_json,
		has_action_item, has_reminder
		FROM emails
		WHERE account_email = ? AND classified_at IS NOT NULL AND extracted_at IS NULL
			AND extraction_error IS NULL AND deleted_at IS NULL
			AND (has_action_item = 1 OR has_reminder = 1)`)
		.all(accountEmail) as Array<Record<string, unknown>>;
	return rows.map((row) => ({
		email: {
			id: String(row.gmail_id),
			threadId: row.thread_id === null ? undefined : String(row.thread_id),
			from: String(row.from_address),
			to: String(row.to_addresses),
			subject: String(row.subject),
			date: row.message_date === null ? undefined : String(row.message_date),
			snippet: String(row.snippet),
			bodyText: String(row.body_text),
			bodyHtml: row.body_html === null ? undefined : String(row.body_html),
			bodyTruncated: Boolean(row.body_truncated),
			labels: JSON.parse(String(row.labels_json)) as string[]
		},
		targets: {
			actionItems: Boolean(row.has_action_item),
			reminders: Boolean(row.has_reminder)
		}
	}));
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
      action_items_json, reminders_json, extraction_model, extraction_error,
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
		actionItems: row.action_items_json === null
			? []
			: JSON.parse(String(row.action_items_json)) as StoredEmail['actionItems'],
		reminders: row.reminders_json === null
			? []
			: JSON.parse(String(row.reminders_json)) as StoredEmail['reminders'],
		extractionModel: row.extraction_model === null ? null : String(row.extraction_model),
		extractionError: row.extraction_error === null ? null : String(row.extraction_error),
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
			action_items_json = NULL, reminders_json = NULL, extraction_model = NULL,
			extraction_error = NULL, extracted_at = NULL,
			classified_at = NULL, classification_error = NULL
			WHERE category = ?`).run(id);
		database.prepare('DELETE FROM categories WHERE id = ?').run(id);
	});
}
