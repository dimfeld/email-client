import type { DatabaseSync } from 'node:sqlite';
import { listAccounts, replaceCalendars, replaceContacts } from './db';
import { googleApiRequest, type GoogleAccount } from './google-api';
import type { SyncedCalendar, SyncedCalendarEvent, SyncedContact } from './types';

export function normalizeContact(contact: Record<string, unknown>): Omit<SyncedContact, 'accountEmail'> {
	const resourceName = typeof contact.resourceName === 'string' ? contact.resourceName : undefined;
	if (!resourceName) throw new Error('A Google contact did not include a resource name.');
	const names = Array.isArray(contact.names) ? contact.names as Array<Record<string, unknown>> : [];
	const organizations = Array.isArray(contact.organizations) ? contact.organizations as Array<Record<string, unknown>> : [];
	const organizationName = typeof organizations[0]?.name === 'string' ? organizations[0].name : undefined;
	const organizationTitle = typeof organizations[0]?.title === 'string' ? organizations[0].title : undefined;
	const values = (key: string) => (Array.isArray(contact[key]) ? contact[key] as Array<Record<string, unknown>> : [])
		.flatMap((item) => typeof item.value === 'string' ? [item.value] : []);
	return {
		resourceName,
		displayName: typeof names[0]?.displayName === 'string' ? names[0].displayName : '',
		emails: values('emailAddresses'),
		phones: values('phoneNumbers'),
		organization: [organizationName, organizationTitle].filter(Boolean).join(' — ') || null
	};
}

export function normalizeCalendar(calendar: Record<string, unknown>): Omit<SyncedCalendar, 'accountEmail'> {
	if (typeof calendar.id !== 'string') throw new Error('A Google calendar did not include an id.');
	return {
		calendarId: calendar.id,
		summary: typeof calendar.summary === 'string' ? calendar.summary : calendar.id,
		timeZone: typeof calendar.timeZone === 'string' ? calendar.timeZone : null,
		backgroundColor: typeof calendar.backgroundColor === 'string' ? calendar.backgroundColor : null,
		selected: Boolean(calendar.selected)
	};
}

function eventTime(value: unknown): { value: string; allDay: boolean } | null {
	if (!value || typeof value !== 'object') return null;
	const record = value as Record<string, unknown>;
	if (typeof record.dateTime === 'string') return { value: record.dateTime, allDay: false };
	return typeof record.date === 'string' ? { value: record.date, allDay: true } : null;
}

function emailFrom(value: unknown): string | null {
	return value && typeof value === 'object' && typeof (value as Record<string, unknown>).email === 'string'
		? (value as Record<string, string>).email : null;
}

export function normalizeCalendarEvent(event: Record<string, unknown>, calendarId: string): Omit<SyncedCalendarEvent, 'accountEmail'> {
	const start = eventTime(event.start);
	const end = eventTime(event.end);
	if (typeof event.id !== 'string' || !start || !end) throw new Error('A Google calendar event did not include its id, start, or end.');
	return {
		calendarId, eventId: event.id,
		summary: typeof event.summary === 'string' ? event.summary : '(No title)',
		description: typeof event.description === 'string' ? event.description : null,
		location: typeof event.location === 'string' ? event.location : null,
		startAt: start.value, endAt: end.value, allDay: start.allDay,
		status: typeof event.status === 'string' ? event.status : '',
		htmlLink: typeof event.htmlLink === 'string' ? event.htmlLink : null,
		organizer: emailFrom(event.organizer),
		attendees: (Array.isArray(event.attendees) ? event.attendees : []).flatMap((item) => {
			const email = emailFrom(item); return email ? [email] : [];
		})
	};
}

export type GoogleSyncResult = { contacts: number; calendars: number; events: number };
type Request = typeof googleApiRequest;

export async function syncGoogleAccount(database: DatabaseSync, account: GoogleAccount, request: Request = googleApiRequest): Promise<GoogleSyncResult> {
	const contacts: Omit<SyncedContact, 'accountEmail'>[] = [];
	let pageToken: string | undefined;
	do {
		const result = await request<{ connections?: Record<string, unknown>[]; nextPageToken?: string }>(account,
			'https://people.googleapis.com/v1/people/me/connections',
			{ params: { personFields: 'names,emailAddresses,phoneNumbers,organizations', pageSize: 1000, pageToken } });
		contacts.push(...(result.connections ?? []).map(normalizeContact));
		pageToken = result.nextPageToken;
	} while (pageToken);

	const calendars: Omit<SyncedCalendar, 'accountEmail'>[] = [];
	pageToken = undefined;
	do {
		const result: { items?: Record<string, unknown>[]; nextPageToken?: string } = await request(account,
			'https://www.googleapis.com/calendar/v3/users/me/calendarList', { params: { pageToken } });
		calendars.push(...(result.items ?? []).map(normalizeCalendar));
		pageToken = result.nextPageToken;
	} while (pageToken);

	const events: Omit<SyncedCalendarEvent, 'accountEmail'>[] = [];
	for (const calendar of calendars) {
		pageToken = undefined;
		do {
			const result: { items?: Record<string, unknown>[]; nextPageToken?: string } = await request(account,
				`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.calendarId)}/events`,
				{ params: { singleEvents: true, orderBy: 'startTime', pageToken } });
			events.push(...(result.items ?? []).map((event) => normalizeCalendarEvent(event, calendar.calendarId)));
			pageToken = result.nextPageToken;
		} while (pageToken);
	}

	const syncedAt = new Date().toISOString();
	replaceContacts(database, account.email, contacts, syncedAt);
	replaceCalendars(database, account.email, calendars, events, syncedAt);
	return { contacts: contacts.length, calendars: calendars.length, events: events.length };
}

export async function syncConfiguredGoogleAccounts(database: DatabaseSync, accountEmail?: string, request: Request = googleApiRequest): Promise<Array<{ account: string; result: GoogleSyncResult }>> {
	const accounts = listAccounts(database).filter((account) => account.enabled && account.refreshToken && (!accountEmail || account.email === accountEmail));
	if (accountEmail && accounts.length === 0) throw new Error(`No connected account is configured for ${accountEmail}.`);
	const results = [];
	for (const account of accounts) results.push({ account: account.email, result: await syncGoogleAccount(database, account, request) });
	return results;
}
