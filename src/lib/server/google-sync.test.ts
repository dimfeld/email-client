import { describe, expect, it } from 'bun:test';
import { createDatabase, listCalendarEvents, listCalendars, listContacts, replaceContacts, upsertAccount } from './db';
import { normalizeCalendarEvent, normalizeContact, syncGoogleAccount } from './google-sync';

describe('Google data normalization', () => {
	it('normalizes Google People contact fields', () => {
		expect(normalizeContact({
			resourceName: 'people/contact-1',
			names: [{ displayName: 'Ada Lovelace' }],
			emailAddresses: [{ value: 'ada@example.com' }],
			phoneNumbers: [{ value: '+1 555 0100' }],
			organizations: [{ name: 'Analytical Engines', title: 'Programmer' }]
		})).toEqual({
			resourceName: 'people/contact-1', displayName: 'Ada Lovelace',
			emails: ['ada@example.com'], phones: ['+1 555 0100'],
			organization: 'Analytical Engines — Programmer'
		});
	});

	it('normalizes timed and all-day Google Calendar events', () => {
		expect(normalizeCalendarEvent({
			id: 'event-1', CalendarID: 'primary', summary: 'Planning',
			start: { dateTime: '2026-09-20T09:00:00-10:00' },
			end: { dateTime: '2026-09-20T10:00:00-10:00' },
			organizer: { email: 'owner@example.com' }, attendees: [{ email: 'guest@example.com' }]
		})).toMatchObject({ eventId: 'event-1', calendarId: 'primary', allDay: false,
			organizer: 'owner@example.com', attendees: ['guest@example.com'] });
		expect(normalizeCalendarEvent({
			id: 'event-2', CalendarID: 'primary', start: { date: '2026-09-21' }, end: { date: '2026-09-22' }
		}).allDay).toBe(true);
	});
});

describe('Google contacts and calendar sync', () => {
	it('paginates contacts, loads details, and replaces account-scoped snapshots', async () => {
		const database = createDatabase(':memory:');
		upsertAccount(database, { email: 'owner@example.com', client: 'work' });
		const commands: string[][] = [];
		const runJson = async (command: string[]): Promise<unknown> => {
			commands.push(command);
			if (command[1] === 'contacts' && command[2] === 'list') {
				return command.includes('--page')
					? { contacts: [{ resource: 'people/two', name: 'Two' }] }
					: { contacts: [{ resource: 'people/one', name: 'One' }], nextPageToken: 'page-2' };
			}
			if (command[1] === 'contacts' && command[2] === 'get') return {
				contact: { resourceName: command[3], names: [{ displayName: command[3].endsWith('one') ? 'One' : 'Two' }],
					emailAddresses: [{ value: `${command[3].split('/')[1]}@example.com` }] }
			};
			if (command[1] === 'calendar' && command[2] === 'calendars') return {
				calendars: [{ id: 'primary', summary: 'Main', timeZone: 'Pacific/Honolulu', selected: true }]
			};
			return { events: [{ id: 'event', CalendarID: 'primary', summary: 'Meeting',
				start: { dateTime: '2026-09-20T09:00:00-10:00' }, end: { dateTime: '2026-09-20T10:00:00-10:00' } }] };
		};

		const result = await syncGoogleAccount(database, { email: 'owner@example.com', client: 'work' }, runJson);
		expect(result).toEqual({ contacts: 2, calendars: 1, events: 1 });
		expect(listContacts(database).map((contact) => contact.displayName)).toEqual(['One', 'Two']);
		expect(listCalendars(database)[0]).toMatchObject({ calendarId: 'primary', summary: 'Main' });
		expect(listCalendarEvents(database)[0]).toMatchObject({ eventId: 'event', summary: 'Meeting' });
		expect(commands.every((command) => command.includes('--readonly') && command.includes('--no-input'))).toBe(true);
		expect(commands.find((command) => command[2] === 'events')).toContain('--all-pages');
		database.close();
	});

	it('keeps the previous contact snapshot when a later download fails', async () => {
		const database = createDatabase(':memory:');
		upsertAccount(database, { email: 'owner@example.com' });
		replaceContacts(database, 'owner@example.com', [{ resourceName: 'old', displayName: 'Existing', emails: [], phones: [], organization: null }]);
		const runJson = async (command: string[]): Promise<unknown> => {
			if (command[2] === 'list') return { contacts: [] };
			throw new Error('Calendar is unavailable');
		};
		await expect(syncGoogleAccount(database, { email: 'owner@example.com', client: 'default' }, runJson)).rejects.toThrow('Calendar is unavailable');
		expect(listContacts(database).map((contact) => contact.displayName)).toEqual(['Existing']);
		database.close();
	});
});
