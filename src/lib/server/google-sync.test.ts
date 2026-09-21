import { describe, expect, it } from 'bun:test';
import { createDatabase, listCalendarEvents, listCalendars, listContacts, replaceContacts, upsertAccount } from './db';
import { GoogleApiError, type GoogleAccount } from './google-api';
import { normalizeCalendarEvent, normalizeContact, syncGoogleAccount } from './google-sync';

describe('Google data normalization', () => {
	it('normalizes Google People contact fields', () => {
		expect(normalizeContact({
			resourceName: 'people/contact-1', names: [{ displayName: 'Ada Lovelace' }],
			emailAddresses: [{ value: 'ada@example.com' }], phoneNumbers: [{ value: '+1 555 0100' }],
			organizations: [{ name: 'Analytical Engines', title: 'Programmer' }]
		})).toEqual({
			resourceName: 'people/contact-1', displayName: 'Ada Lovelace', emails: ['ada@example.com'],
			phones: ['+1 555 0100'], organization: 'Analytical Engines — Programmer'
		});
	});

	it('normalizes timed and all-day Google Calendar events', () => {
		expect(normalizeCalendarEvent({ id: 'event-1', summary: 'Planning',
			start: { dateTime: '2026-09-20T09:00:00-10:00' }, end: { dateTime: '2026-09-20T10:00:00-10:00' },
			organizer: { email: 'owner@example.com' }, attendees: [{ email: 'guest@example.com' }] }, 'primary'))
			.toMatchObject({ eventId: 'event-1', calendarId: 'primary', allDay: false,
				organizer: 'owner@example.com', attendees: ['guest@example.com'] });
		expect(normalizeCalendarEvent({ id: 'event-2', start: { date: '2026-09-21' }, end: { date: '2026-09-22' } }, 'primary').allDay).toBe(true);
	});
});

describe('Google contacts and calendar sync', () => {
	it('paginates contacts and replaces account-scoped snapshots', async () => {
		const database = createDatabase(':memory:');
		upsertAccount(database, { email: 'owner@example.com', refreshToken: 'token' });
		const calls: string[] = [];
		const request = async <T>(_account: GoogleAccount, url: string, options?: { params?: Record<string, unknown> }): Promise<T> => {
			calls.push(url);
			if (url.includes('connections')) return (options?.params?.pageToken
				? { connections: [{ resourceName: 'people/two', names: [{ displayName: 'Two' }] }] }
				: { connections: [{ resourceName: 'people/one', names: [{ displayName: 'One' }] }], nextPageToken: 'page-2' }) as T;
			if (url.includes('calendarList')) return { items: [{ id: 'primary', summary: 'Main', selected: true }] } as T;
			return { items: [{ id: 'event', summary: 'Meeting', start: { dateTime: '2026-09-20T09:00:00-10:00' }, end: { dateTime: '2026-09-20T10:00:00-10:00' } }] } as T;
		};

		const result = await syncGoogleAccount(database, { email: 'owner@example.com', refreshToken: 'token' }, request, { pageDelayMs: 0 });
		expect(result).toEqual({ contacts: 2, calendars: 1, events: 1 });
		expect(listContacts(database).map((contact) => contact.displayName)).toEqual(['One', 'Two']);
		expect(listCalendars(database)[0]).toMatchObject({ calendarId: 'primary', summary: 'Main' });
		expect(listCalendarEvents(database)[0]).toMatchObject({ eventId: 'event', summary: 'Meeting' });
		expect(calls.filter((url) => url.includes('connections'))).toHaveLength(2);
		database.close();
	});

	it('keeps the previous contact snapshot when a later download fails', async () => {
		const database = createDatabase(':memory:');
		upsertAccount(database, { email: 'owner@example.com', refreshToken: 'token' });
		replaceContacts(database, 'owner@example.com', [{ resourceName: 'old', displayName: 'Existing', emails: [], phones: [], organization: null }]);
		const request = async <T>(_account: GoogleAccount, url: string): Promise<T> => {
			if (url.includes('connections')) return { connections: [] } as T;
			throw new Error('Calendar is unavailable');
		};
		await expect(syncGoogleAccount(database, { email: 'owner@example.com', refreshToken: 'token' }, request)).rejects.toThrow('Calendar is unavailable');
		expect(listContacts(database).map((contact) => contact.displayName)).toEqual(['Existing']);
		database.close();
	});

	it('resumes Contacts from the last stored page after a rate limit', async () => {
		const database = createDatabase(':memory:');
		upsertAccount(database, { email: 'owner@example.com', refreshToken: 'token' });
		const calls: Array<{ url: string; pageToken?: unknown }> = [];
		let limited = true;
		const request = async <T>(_account: GoogleAccount, url: string, options?: { params?: Record<string, unknown> }): Promise<T> => {
			calls.push({ url, pageToken: options?.params?.pageToken });
			if (url.includes('connections')) {
				if (options?.params?.pageToken === 'contacts-2' && limited) {
					limited = false;
					throw new GoogleApiError('Too Many Requests', 429);
				}
				return (options?.params?.pageToken
					? { connections: [{ resourceName: 'people/two', names: [{ displayName: 'Two' }] }] }
					: { connections: [{ resourceName: 'people/one', names: [{ displayName: 'One' }] }], nextPageToken: 'contacts-2' }) as T;
			}
			if (url.includes('calendarList')) return { items: [] } as T;
			return { items: [] } as T;
		};

		await expect(syncGoogleAccount(database, { email: 'owner@example.com', refreshToken: 'token' }, request, { pageDelayMs: 0 }))
			.resolves.toMatchObject({ contacts: 1, deferred: true });
		await expect(syncGoogleAccount(database, { email: 'owner@example.com', refreshToken: 'token' }, request, { pageDelayMs: 0 }))
			.resolves.toEqual({ contacts: 2, calendars: 0, events: 0 });
		expect(calls.filter((call) => call.url.includes('connections')).map((call) => call.pageToken)).toEqual([
			undefined, 'contacts-2', 'contacts-2'
		]);
		expect(listContacts(database).map((contact) => contact.displayName)).toEqual(['One', 'Two']);
		database.close();
	});

	it('paces requests between background sync pages', async () => {
		const database = createDatabase(':memory:');
		upsertAccount(database, { email: 'owner@example.com', refreshToken: 'token' });
		const delays: number[] = [];
		const request = async <T>(_account: GoogleAccount, url: string, options?: { params?: Record<string, unknown> }): Promise<T> => {
			if (url.includes('connections')) return (options?.params?.pageToken
				? { connections: [] }
				: { connections: [], nextPageToken: 'contacts-2' }) as T;
			return { items: [] } as T;
		};

		await syncGoogleAccount(database, { email: 'owner@example.com', refreshToken: 'token' }, request, {
			pageDelayMs: 12,
			sleep: async (delay) => { delays.push(delay); }
		});
		expect(delays).toEqual([12, 12]);
		database.close();
	});

	it('resumes Calendar events from the last stored page after a rate limit', async () => {
		const database = createDatabase(':memory:');
		upsertAccount(database, { email: 'owner@example.com', refreshToken: 'token' });
		const eventCalls: unknown[] = [];
		let limited = true;
		const request = async <T>(_account: GoogleAccount, url: string, options?: { params?: Record<string, unknown> }): Promise<T> => {
			if (url.includes('connections')) return { connections: [] } as T;
			if (url.includes('calendarList')) return { items: [{ id: 'primary', summary: 'Main' }] } as T;
			eventCalls.push(options?.params?.pageToken);
			if (options?.params?.pageToken === 'events-2' && limited) {
				limited = false;
				throw new GoogleApiError('Rate limit exceeded', 403);
			}
			return (options?.params?.pageToken
				? { items: [{ id: 'event-2', start: { date: '2026-09-21' }, end: { date: '2026-09-22' } }] }
				: { items: [{ id: 'event-1', start: { date: '2026-09-20' }, end: { date: '2026-09-21' } }], nextPageToken: 'events-2' }) as T;
		};

		await expect(syncGoogleAccount(database, { email: 'owner@example.com', refreshToken: 'token' }, request, { pageDelayMs: 0 }))
			.resolves.toMatchObject({ calendars: 1, events: 1, deferred: true });
		await expect(syncGoogleAccount(database, { email: 'owner@example.com', refreshToken: 'token' }, request, { pageDelayMs: 0 }))
			.resolves.toEqual({ contacts: 0, calendars: 1, events: 2 });
		expect(eventCalls).toEqual([undefined, 'events-2', 'events-2']);
		expect(listCalendarEvents(database).map((event) => event.eventId)).toEqual(['event-1', 'event-2']);
		database.close();
	});
});
