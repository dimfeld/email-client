import type { DatabaseSync } from 'node:sqlite';
import { listAccounts, replaceCalendars, replaceContacts } from './db';
import { runGogJson } from './gog';
import type { SyncedCalendar, SyncedCalendarEvent, SyncedContact } from './types';

type GoogleSyncAccount = { email: string; client: string };

function objectValue(value: unknown, message: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
	return value as Record<string, unknown>;
}

function stringValue(value: Record<string, unknown>, ...keys: string[]): string | undefined {
	for (const key of keys) if (typeof value[key] === 'string') return value[key] as string;
}

function arrayValue(value: Record<string, unknown>, ...keys: string[]): unknown[] {
	for (const key of keys) if (Array.isArray(value[key])) return value[key] as unknown[];
	return [];
}

function propertyValues(value: Record<string, unknown>, keys: string[]): string[] {
	return arrayValue(value, ...keys).flatMap((item) => {
		if (typeof item === 'string') return [item];
		if (!item || typeof item !== 'object') return [];
		const text = stringValue(item as Record<string, unknown>, 'value', 'address', 'number');
		return text ? [text] : [];
	});
}

export function normalizeContact(value: unknown): Omit<SyncedContact, 'accountEmail'> {
	const contact = objectValue(value, 'gog returned an invalid contact.');
	const resourceName = stringValue(contact, 'resourceName', 'resource', 'resource_name');
	if (!resourceName) throw new Error('A gog contact did not include a resource name.');
	const names = arrayValue(contact, 'names');
	const firstName = names[0] && typeof names[0] === 'object'
		? names[0] as Record<string, unknown>
		: {};
	const organizations = arrayValue(contact, 'organizations');
	const firstOrganization = organizations[0] && typeof organizations[0] === 'object'
		? organizations[0] as Record<string, unknown>
		: {};
	const organizationName = stringValue(firstOrganization, 'name');
	const organizationTitle = stringValue(firstOrganization, 'title');
	return {
		resourceName,
		displayName: stringValue(firstName, 'displayName', 'display_name')
			?? stringValue(contact, 'name', 'displayName', 'display_name')
			?? '',
		emails: propertyValues(contact, ['emailAddresses', 'emails', 'email_addresses']),
		phones: propertyValues(contact, ['phoneNumbers', 'phones', 'phone_numbers']),
		organization: [organizationName, organizationTitle].filter(Boolean).join(' — ') || null
	};
}

export function normalizeCalendar(value: unknown): Omit<SyncedCalendar, 'accountEmail'> {
	const calendar = objectValue(value, 'gog returned an invalid calendar.');
	const calendarId = stringValue(calendar, 'id', 'calendarId', 'calendar_id');
	if (!calendarId) throw new Error('A gog calendar did not include an id.');
	return {
		calendarId,
		summary: stringValue(calendar, 'summary', 'name') ?? calendarId,
		timeZone: stringValue(calendar, 'timeZone', 'timezone', 'time_zone') ?? null,
		backgroundColor: stringValue(calendar, 'backgroundColor', 'background_color') ?? null,
		selected: Boolean(calendar.selected)
	};
}

function eventTime(value: unknown): { value: string; allDay: boolean } | null {
	if (typeof value === 'string') return { value, allDay: /^\d{4}-\d{2}-\d{2}$/.test(value) };
	if (!value || typeof value !== 'object') return null;
	const record = value as Record<string, unknown>;
	const dateTime = stringValue(record, 'dateTime', 'date_time');
	if (dateTime) return { value: dateTime, allDay: false };
	const date = stringValue(record, 'date');
	return date ? { value: date, allDay: true } : null;
}

function emailFrom(value: unknown): string | null {
	if (typeof value === 'string') return value;
	if (!value || typeof value !== 'object') return null;
	return stringValue(value as Record<string, unknown>, 'email') ?? null;
}

export function normalizeCalendarEvent(value: unknown): Omit<SyncedCalendarEvent, 'accountEmail'> {
	const event = objectValue(value, 'gog returned an invalid calendar event.');
	const eventId = stringValue(event, 'id', 'eventId', 'event_id');
	const calendarId = stringValue(event, 'CalendarID', 'calendarId', 'calendar_id');
	const start = eventTime(event.start ?? event.startLocal ?? event.start_local);
	const end = eventTime(event.end ?? event.endLocal ?? event.end_local);
	if (!eventId || !calendarId || !start || !end) {
		throw new Error('A gog calendar event did not include its id, calendar, start, or end.');
	}
	return {
		calendarId,
		eventId,
		summary: stringValue(event, 'summary', 'title') ?? '(No title)',
		description: stringValue(event, 'description') ?? null,
		location: stringValue(event, 'location') ?? null,
		startAt: start.value,
		endAt: end.value,
		allDay: start.allDay,
		status: stringValue(event, 'status') ?? '',
		htmlLink: stringValue(event, 'htmlLink', 'html_link') ?? null,
		organizer: emailFrom(event.organizer),
		attendees: arrayValue(event, 'attendees').flatMap((attendee) => {
			const email = emailFrom(attendee);
			return email ? [email] : [];
		})
	};
}

function resultArray(value: unknown, key: string): unknown[] {
	const result = objectValue(value, `gog returned invalid ${key} results.`);
	if (result[key] === undefined) return [];
	if (!Array.isArray(result[key])) throw new Error(`gog ${key} results did not include a list.`);
	return result[key] as unknown[];
}

async function loadContacts(
	account: GoogleSyncAccount,
	runJson: typeof runGogJson
): Promise<Omit<SyncedContact, 'accountEmail'>[]> {
	const summaries: unknown[] = [];
	let page: string | undefined;
	do {
		const result = await runJson([
			'gog', 'contacts', 'list', '--account', account.email, '--client', account.client,
			'--json', '--no-input', '--readonly', ...(page ? ['--page', page] : [])
		]);
		summaries.push(...resultArray(result, 'contacts'));
		page = stringValue(objectValue(result, 'gog returned invalid contact results.'), 'nextPageToken', 'next_page_token');
	} while (page);

	const contacts: Omit<SyncedContact, 'accountEmail'>[] = [];
	for (const summary of summaries) {
		const normalizedSummary = normalizeContact(summary);
		const result = objectValue(await runJson([
			'gog', 'contacts', 'get', normalizedSummary.resourceName, '--account', account.email,
			'--client', account.client, '--json', '--no-input', '--readonly'
		]), 'gog returned an invalid contact detail result.');
		contacts.push(normalizeContact(result.contact ?? result));
	}
	return contacts;
}

export type GoogleSyncResult = { contacts: number; calendars: number; events: number };

export async function syncGoogleAccount(
	database: DatabaseSync,
	account: GoogleSyncAccount,
	runJson: typeof runGogJson = runGogJson
): Promise<GoogleSyncResult> {
	const contacts = await loadContacts(account, runJson);
	const calendarsResult = await runJson([
		'gog', 'calendar', 'calendars', '--account', account.email, '--client', account.client,
		'--json', '--all', '--no-input', '--readonly'
	]);
	const eventsResult = await runJson([
		'gog', 'calendar', 'events', '--all', '--account', account.email, '--client', account.client,
		'--json', '--all-pages', '--no-input', '--readonly'
	]);
	const calendars = resultArray(calendarsResult, 'calendars').map(normalizeCalendar);
	const events = resultArray(eventsResult, 'events').map(normalizeCalendarEvent);
	const calendarIds = new Set(calendars.map((calendar) => calendar.calendarId));
	for (const event of events) {
		if (!calendarIds.has(event.calendarId)) {
			calendars.push({ calendarId: event.calendarId, summary: event.calendarId, timeZone: null,
				backgroundColor: null, selected: false });
			calendarIds.add(event.calendarId);
		}
	}
	const syncedAt = new Date().toISOString();
	replaceContacts(database, account.email, contacts, syncedAt);
	replaceCalendars(database, account.email, calendars, events, syncedAt);
	return { contacts: contacts.length, calendars: calendars.length, events: events.length };
}

export async function syncConfiguredGoogleAccounts(
	database: DatabaseSync,
	accountEmail?: string,
	runJson: typeof runGogJson = runGogJson
): Promise<Array<{ account: string; result: GoogleSyncResult }>> {
	const accounts = listAccounts(database).filter((account) => account.enabled && (!accountEmail || account.email === accountEmail));
	if (accountEmail && accounts.length === 0) throw new Error(`No enabled account is configured for ${accountEmail}.`);
	const results = [];
	for (const account of accounts) {
		results.push({ account: account.email, result: await syncGoogleAccount(database, account, runJson) });
	}
	return results;
}
