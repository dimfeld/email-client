import type { DatabaseSync } from 'node:sqlite';
import {
	applyCalendarEventsIncrementalSync,
	applyCalendarListIncrementalSync,
	applyContactsIncrementalSync,
	applyGoogleOtherContactsIncrementalSync,
	finalizeGoogleSync,
	getGoogleOtherContactsSyncProgress,
	getGoogleSyncProgress,
	getGoogleSyncState,
	listAccounts,
	resetGoogleSyncState,
	saveCalendarEventsSyncPage,
	saveCalendarListSyncPage,
	saveContactsSyncPage,
	saveGoogleOtherContactsSyncPage,
	startGoogleOtherContactsSync,
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
		responseStatus: (Array.isArray(event.attendees) ? event.attendees : []).find((item) => item.self === true)?.responseStatus ?? null,
		attendees: (Array.isArray(event.attendees) ? event.attendees : []).flatMap((item) => {
			const email = emailFrom(item); return email ? [email] : [];
		})
	};
}

export type GoogleSyncResult = { contacts: number; calendars: number; events: number; deferred?: boolean };
export const GOOGLE_SYNC_PAGE_DELAY_MS = 250;
type Request = typeof googleApiRequest;
export type GoogleSyncOptions = { pageDelayMs?: number; sleep?: (delayMs: number) => Promise<void> };

function sleep(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

type ContactsPage = { connections?: Record<string, unknown>[]; nextPageToken?: string; nextSyncToken?: string };
type OtherContactsPage = { otherContacts?: Record<string, unknown>[]; nextPageToken?: string; nextSyncToken?: string };
type CalendarPage = { items?: Record<string, unknown>[]; nextPageToken?: string; nextSyncToken?: string };

function isDeleted(value: Record<string, unknown>): boolean {
	return Boolean(value.deleted) || Boolean(
		value.metadata && typeof value.metadata === 'object' && (value.metadata as Record<string, unknown>).deleted
	);
}

function previousResourceNames(value: Record<string, unknown>): string[] {
	if (!value.metadata || typeof value.metadata !== 'object') return [];
	const names = (value.metadata as Record<string, unknown>).previousResourceNames;
	return Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string') : [];
}

function requireSyncToken(token: string | undefined, resource: string): string {
	if (!token) throw new Error(`${resource} sync did not return a sync token.`);
	return token;
}

function isExpiredSyncToken(error: unknown): boolean {
	return (error instanceof Error && /expired[^.]*sync[^.]*token|sync[^.]*token[^.]*expired/i.test(error.message))
		|| (error instanceof Error && 'status' in error && (error as { status?: unknown }).status === 410);
}

async function syncGoogleAccountOnce(
	database: DatabaseSync,
	account: GoogleAccount,
	request: Request = googleApiRequest,
	{ pageDelayMs = GOOGLE_SYNC_PAGE_DELAY_MS, sleep: wait = sleep }: GoogleSyncOptions = {}
): Promise<GoogleSyncResult> {
	let requestedPage = false;
	const fetched = { contacts: 0, calendars: 0, events: 0 };
	const requestPage = async <T>(url: string, params: Record<string, string | number | boolean | undefined>): Promise<T> => {
		if (requestedPage && pageDelayMs > 0) await wait(pageDelayMs);
		requestedPage = true;
		return request<T>(account, url, { params });
	};

	const fullSync = async (): Promise<GoogleSyncResult> => {
		let deferred = false;
		let contactsProgress = startGoogleSync(database, account.email, 'contacts');
		while (contactsProgress.phase !== 'complete') {
			let result: ContactsPage;
			try {
				result = await requestPage('https://people.googleapis.com/v1/people/me/connections', {
					personFields: 'names,emailAddresses,phoneNumbers,organizations,metadata', pageSize: 1000,
					requestSyncToken: true, pageToken: contactsProgress.pageToken ?? undefined
				});
			} catch (error) {
				if (!isGoogleRateLimitError(error)) throw error;
				deferred = true;
				break;
			}
			saveContactsSyncPage(database, contactsProgress,
				(result.connections ?? []).filter((contact) => !isDeleted(contact)).map(normalizeContact),
				result.nextPageToken, result.nextSyncToken);
			fetched.contacts += result.connections?.length ?? 0;
			contactsProgress = getGoogleSyncProgress(database, account.email, 'contacts')!;
		}

		if (!deferred) {
			let otherContactsProgress = startGoogleOtherContactsSync(database, account.email);
			while (otherContactsProgress.phase !== 'complete') {
				let result: OtherContactsPage;
				try {
					result = await requestPage('https://people.googleapis.com/v1/otherContacts', {
						readMask: 'names,emailAddresses,phoneNumbers,metadata', pageSize: 1000,
						requestSyncToken: true, pageToken: otherContactsProgress.pageToken ?? undefined
					});
				} catch (error) {
					if (!isGoogleRateLimitError(error)) throw error;
					deferred = true;
					break;
				}
				saveGoogleOtherContactsSyncPage(database, otherContactsProgress,
					(result.otherContacts ?? []).filter((contact) => !isDeleted(contact)).map(normalizeContact),
					result.nextPageToken, result.nextSyncToken);
				fetched.contacts += result.otherContacts?.length ?? 0;
				otherContactsProgress = getGoogleOtherContactsSyncProgress(database, account.email)!;
			}
		}

		if (!deferred) {
			let calendarProgress = startGoogleSync(database, account.email, 'calendar');
			while (calendarProgress.phase === 'calendarList') {
				let result: CalendarPage;
				try {
					result = await requestPage('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
						showDeleted: true, showHidden: true, pageToken: calendarProgress.pageToken ?? undefined
					});
				} catch (error) {
					if (!isGoogleRateLimitError(error)) throw error;
					deferred = true;
					break;
				}
				const next = saveCalendarListSyncPage(database, calendarProgress,
					(result.items ?? []).filter((calendar) => !isDeleted(calendar)).map(normalizeCalendar),
					result.nextPageToken, result.nextSyncToken);
				fetched.calendars += result.items?.length ?? 0;
				calendarProgress = next ?? getGoogleSyncProgress(database, account.email, 'calendar')!;
			}

			while (!deferred && calendarProgress.phase === 'calendarEvents') {
				let result: CalendarPage;
				try {
					result = await requestPage(
						`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarProgress.calendarId!)}/events`,
						{ singleEvents: true, showDeleted: true, pageToken: calendarProgress.pageToken ?? undefined }
					);
				} catch (error) {
					if (!isGoogleRateLimitError(error)) throw error;
					deferred = true;
					break;
				}
				const next = saveCalendarEventsSyncPage(database, calendarProgress,
					(result.items ?? []).filter((event) => !isDeleted(event) && event.status !== 'cancelled')
						.map((event) => normalizeCalendarEvent(event, calendarProgress.calendarId!)),
					result.nextPageToken, result.nextSyncToken);
				fetched.events += result.items?.length ?? 0;
				calendarProgress = next ?? getGoogleSyncProgress(database, account.email, 'calendar')!;
			}
		}

		if (!deferred) {
			const calendarProgress = getGoogleSyncProgress(database, account.email, 'calendar');
			const contactsProgress = getGoogleSyncProgress(database, account.email, 'contacts');
			const otherContactsProgress = getGoogleOtherContactsSyncProgress(database, account.email);
			if (contactsProgress?.phase === 'complete' && otherContactsProgress?.phase === 'complete'
				&& calendarProgress?.phase === 'complete') finalizeGoogleSync(database, account.email);
		}
		return deferred ? { ...fetched, deferred: true } : fetched;
	};

	const contactsProgress = getGoogleSyncProgress(database, account.email, 'contacts');
	const otherContactsProgress = getGoogleOtherContactsSyncProgress(database, account.email);
	const calendarProgress = getGoogleSyncProgress(database, account.email, 'calendar');
	if ((contactsProgress?.phase === 'complete' && !contactsProgress.nextSyncToken)
		|| (otherContactsProgress?.phase === 'complete' && !otherContactsProgress.nextSyncToken)
		|| (calendarProgress?.phase === 'complete' && !calendarProgress.nextSyncToken)) {
		resetGoogleSyncState(database, account.email);
		return fullSync();
	}
	const state = getGoogleSyncState(database, account.email);
	if (!state.contactsSyncToken || !state.otherContactsSyncToken || !state.calendarListSyncToken
		|| contactsProgress || otherContactsProgress || calendarProgress) {
		return fullSync();
	}

	try {
		const changedContacts: Omit<SyncedContact, 'accountEmail'>[] = [];
		const deletedContacts = new Set<string>();
		let contactsPageToken: string | undefined;
		let contactsNextSyncToken: string | undefined;
		do {
			const result = await requestPage<ContactsPage>('https://people.googleapis.com/v1/people/me/connections', {
				personFields: 'names,emailAddresses,phoneNumbers,organizations,metadata', pageSize: 1000,
				requestSyncToken: true, syncToken: state.contactsSyncToken, pageToken: contactsPageToken
			});
			fetched.contacts += result.connections?.length ?? 0;
			for (const contact of result.connections ?? []) {
				for (const oldName of previousResourceNames(contact)) deletedContacts.add(oldName);
				if (isDeleted(contact)) {
					if (typeof contact.resourceName === 'string') deletedContacts.add(contact.resourceName);
				} else changedContacts.push(normalizeContact(contact));
			}
			contactsPageToken = result.nextPageToken;
			contactsNextSyncToken = result.nextSyncToken ?? contactsNextSyncToken;
		} while (contactsPageToken);
		applyContactsIncrementalSync(database, account.email, changedContacts, [...deletedContacts],
			requireSyncToken(contactsNextSyncToken, 'Google Contacts'));

		const changedOtherContacts: Omit<SyncedContact, 'accountEmail'>[] = [];
		const deletedOtherContacts = new Set<string>();
		let otherContactsPageToken: string | undefined;
		let otherContactsNextSyncToken: string | undefined;
		do {
			const result = await requestPage<OtherContactsPage>('https://people.googleapis.com/v1/otherContacts', {
				readMask: 'names,emailAddresses,phoneNumbers,metadata', pageSize: 1000,
				requestSyncToken: true, syncToken: state.otherContactsSyncToken, pageToken: otherContactsPageToken
			});
			fetched.contacts += result.otherContacts?.length ?? 0;
			for (const contact of result.otherContacts ?? []) {
				for (const oldName of previousResourceNames(contact)) deletedOtherContacts.add(oldName);
				if (isDeleted(contact)) {
					if (typeof contact.resourceName === 'string') deletedOtherContacts.add(contact.resourceName);
				} else changedOtherContacts.push(normalizeContact(contact));
			}
			otherContactsPageToken = result.nextPageToken;
			otherContactsNextSyncToken = result.nextSyncToken ?? otherContactsNextSyncToken;
		} while (otherContactsPageToken);
		applyGoogleOtherContactsIncrementalSync(database, account.email, changedOtherContacts, [...deletedOtherContacts],
			requireSyncToken(otherContactsNextSyncToken, 'Google Other Contacts'));

		const changedCalendars: Omit<SyncedCalendar, 'accountEmail'>[] = [];
		const deletedCalendars: string[] = [];
		let calendarPageToken: string | undefined;
		let calendarNextSyncToken: string | undefined;
		do {
			const result = await requestPage<CalendarPage>('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
				showDeleted: true, showHidden: true, syncToken: state.calendarListSyncToken, pageToken: calendarPageToken
			});
			fetched.calendars += result.items?.length ?? 0;
			for (const calendar of result.items ?? []) {
				if (isDeleted(calendar)) {
					if (typeof calendar.id === 'string') deletedCalendars.push(calendar.id);
				} else changedCalendars.push(normalizeCalendar(calendar));
			}
			calendarPageToken = result.nextPageToken;
			calendarNextSyncToken = result.nextSyncToken ?? calendarNextSyncToken;
		} while (calendarPageToken);
		applyCalendarListIncrementalSync(database, account.email, changedCalendars, deletedCalendars,
			requireSyncToken(calendarNextSyncToken, 'Google Calendar list'));

		for (const [calendarId, savedSyncToken] of getGoogleSyncState(database, account.email).calendarEventSyncTokens) {
			const changedEvents: Omit<SyncedCalendarEvent, 'accountEmail'>[] = [];
			const deletedEvents: string[] = [];
			let eventPageToken: string | undefined;
			let eventNextSyncToken: string | undefined;
			let replace = !savedSyncToken;
			try {
				do {
					const result: CalendarPage = await requestPage<CalendarPage>(
						`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
						{ singleEvents: true, showDeleted: true, syncToken: savedSyncToken ?? undefined, pageToken: eventPageToken }
					);
					fetched.events += result.items?.length ?? 0;
					for (const event of result.items ?? []) {
						if (isDeleted(event) || event.status === 'cancelled') {
							if (typeof event.id === 'string') deletedEvents.push(event.id);
						} else changedEvents.push(normalizeCalendarEvent(event, calendarId));
					}
					eventPageToken = result.nextPageToken;
					eventNextSyncToken = result.nextSyncToken ?? eventNextSyncToken;
				} while (eventPageToken);
			} catch (error) {
				if (!savedSyncToken || !isExpiredSyncToken(error)) throw error;
				replace = true;
				changedEvents.length = 0;
				deletedEvents.length = 0;
				eventPageToken = undefined;
				do {
					const result: CalendarPage = await requestPage<CalendarPage>(
						`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
						{ singleEvents: true, showDeleted: true, pageToken: eventPageToken }
					);
					fetched.events += result.items?.length ?? 0;
					changedEvents.push(...(result.items ?? []).filter((event) => !isDeleted(event) && event.status !== 'cancelled')
						.map((event) => normalizeCalendarEvent(event, calendarId)));
					eventPageToken = result.nextPageToken;
					eventNextSyncToken = result.nextSyncToken ?? eventNextSyncToken;
				} while (eventPageToken);
			}
			applyCalendarEventsIncrementalSync(database, account.email, calendarId, changedEvents, deletedEvents,
				requireSyncToken(eventNextSyncToken, `Google Calendar ${calendarId}`), replace);
		}
		return fetched;
	} catch (error) {
		if (isGoogleRateLimitError(error)) return { ...fetched, deferred: true };
		if (!isExpiredSyncToken(error)) throw error;
		resetGoogleSyncState(database, account.email);
		return fullSync();
	}
}

const activeSyncs = new WeakMap<DatabaseSync, Map<string, Promise<GoogleSyncResult>>>();

export function syncGoogleAccount(
	database: DatabaseSync,
	account: GoogleAccount,
	request: Request = googleApiRequest,
	options?: GoogleSyncOptions
): Promise<GoogleSyncResult> {
	let databaseSyncs = activeSyncs.get(database);
	if (!databaseSyncs) {
		databaseSyncs = new Map();
		activeSyncs.set(database, databaseSyncs);
	}
	const active = databaseSyncs.get(account.email);
	if (active) return active;
	const startedAt = Date.now();
	console.info('Google data sync started.', { account: account.email });
	const running = syncGoogleAccountOnce(database, account, request, options)
		.then((result) => {
			const details = {
				account: account.email,
				fetchedContacts: result.contacts,
				fetchedCalendars: result.calendars,
				fetchedEvents: result.events,
				durationMs: Date.now() - startedAt
			};
			if (result.deferred) console.warn('Google data sync deferred.', details);
			else console.info('Google data sync completed.', details);
			return result;
		}, (error: unknown) => {
			console.error('Google data sync failed.', {
				account: account.email,
				durationMs: Date.now() - startedAt,
				error
			});
			throw error;
		})
		.finally(() => databaseSyncs?.delete(account.email));
	databaseSyncs.set(account.email, running);
	return running;
}

export async function syncConfiguredGoogleAccounts(
	database: DatabaseSync,
	accountEmail?: string,
	request: Request = googleApiRequest,
	options?: GoogleSyncOptions
): Promise<Array<{ account: string; result: GoogleSyncResult }>> {
	const accounts = listAccounts(database).filter((account) => account.enabled && account.refreshToken && (!accountEmail || account.email === accountEmail));
	if (accountEmail && accounts.length === 0) throw new Error(`No connected account is configured for ${accountEmail}.`);
	const results = [];
	for (const account of accounts) results.push({ account: account.email, result: await syncGoogleAccount(database, account, request, options) });
	return results;
}
