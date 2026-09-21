import type { DatabaseSync } from 'node:sqlite';
import {
	finalizeGoogleSync,
	getGoogleSyncCounts,
	getGoogleSyncProgress,
	listAccounts,
	saveCalendarEventsSyncPage,
	saveCalendarListSyncPage,
	saveContactsSyncPage,
	startGoogleSync
} from './db';
import { googleApiRequest, isGoogleRateLimitError, type GoogleAccount } from './google-api';
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

export type GoogleSyncResult = { contacts: number; calendars: number; events: number; deferred?: boolean };
export const GOOGLE_SYNC_PAGE_DELAY_MS = 250;
type Request = typeof googleApiRequest;
type SyncOptions = { pageDelayMs?: number; sleep?: (delayMs: number) => Promise<void> };

function sleep(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function syncGoogleAccount(
	database: DatabaseSync,
	account: GoogleAccount,
	request: Request = googleApiRequest,
	{ pageDelayMs = GOOGLE_SYNC_PAGE_DELAY_MS, sleep: wait = sleep }: SyncOptions = {}
): Promise<GoogleSyncResult> {
	let deferred = false;
	let requestedPage = false;
	const requestPage = async <T>(url: string, params: Record<string, string | number | boolean | undefined>): Promise<T> => {
		if (requestedPage && pageDelayMs > 0) await wait(pageDelayMs);
		requestedPage = true;
		return request<T>(account, url, { params });
	};

	let contactsProgress = startGoogleSync(database, account.email, 'contacts');
	while (contactsProgress.phase !== 'complete') {
		let result: { connections?: Record<string, unknown>[]; nextPageToken?: string };
		try {
			result = await requestPage('https://people.googleapis.com/v1/people/me/connections', {
				personFields: 'names,emailAddresses,phoneNumbers,organizations', pageSize: 1000,
				pageToken: contactsProgress.pageToken ?? undefined
			});
		} catch (error) {
			if (!isGoogleRateLimitError(error)) throw error;
			deferred = true;
			break;
		}
		saveContactsSyncPage(database, contactsProgress,
			(result.connections ?? []).map(normalizeContact), result.nextPageToken);
		contactsProgress = getGoogleSyncProgress(database, account.email, 'contacts')!;
	}

	if (!deferred) {
		let calendarProgress = startGoogleSync(database, account.email, 'calendar');
		while (calendarProgress.phase === 'calendarList') {
			let result: { items?: Record<string, unknown>[]; nextPageToken?: string };
			try {
				result = await requestPage('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
					pageToken: calendarProgress.pageToken ?? undefined
				});
			} catch (error) {
				if (!isGoogleRateLimitError(error)) throw error;
				deferred = true;
				break;
			}
			const next = saveCalendarListSyncPage(database, calendarProgress,
				(result.items ?? []).map(normalizeCalendar), result.nextPageToken);
			calendarProgress = next ?? getGoogleSyncProgress(database, account.email, 'calendar')!;
		}

		while (!deferred && calendarProgress.phase === 'calendarEvents') {
			let result: { items?: Record<string, unknown>[]; nextPageToken?: string };
			try {
				result = await requestPage(
					`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarProgress.calendarId!)}/events`,
					{ singleEvents: true, orderBy: 'startTime', pageToken: calendarProgress.pageToken ?? undefined }
				);
			} catch (error) {
				if (!isGoogleRateLimitError(error)) throw error;
				deferred = true;
				break;
			}
			const next = saveCalendarEventsSyncPage(database, calendarProgress,
				(result.items ?? []).map((event) => normalizeCalendarEvent(event, calendarProgress.calendarId!)), result.nextPageToken);
			calendarProgress = next ?? getGoogleSyncProgress(database, account.email, 'calendar')!;
		}
	}

	if (!deferred) {
		const calendarProgress = getGoogleSyncProgress(database, account.email, 'calendar');
		const contactsProgress = getGoogleSyncProgress(database, account.email, 'contacts');
		if (contactsProgress?.phase === 'complete' && calendarProgress?.phase === 'complete') finalizeGoogleSync(database, account.email);
	}
	const result = getGoogleSyncCounts(database, account.email);
	return deferred ? { ...result, deferred: true } : result;
}

export async function syncConfiguredGoogleAccounts(
	database: DatabaseSync,
	accountEmail?: string,
	request: Request = googleApiRequest,
	options?: SyncOptions
): Promise<Array<{ account: string; result: GoogleSyncResult }>> {
	const accounts = listAccounts(database).filter((account) => account.enabled && account.refreshToken && (!accountEmail || account.email === accountEmail));
	if (accountEmail && accounts.length === 0) throw new Error(`No connected account is configured for ${accountEmail}.`);
	const results = [];
	for (const account of accounts) results.push({ account: account.email, result: await syncGoogleAccount(database, account, request, options) });
	return results;
}
