import { describe, expect, it } from 'bun:test';
import type { SyncedCalendar, SyncedCalendarEvent } from './server/types';
import {
	addDays, addMonths, daysBetween, eventOccursOn, eventsOnDay, isCalendarVisible, isDateKey,
	layoutTimedEvents, parseCalendarSelection, setCalendarVisible, shiftView, startOfWeek, viewRange
} from './calendar';

function event(overrides: Partial<SyncedCalendarEvent> & Pick<SyncedCalendarEvent, 'startAt' | 'endAt'>): SyncedCalendarEvent {
	return {
		accountEmail: 'owner@example.com', calendarId: 'primary', eventId: overrides.startAt, summary: 'Event',
		description: null, location: null, allDay: false, status: 'confirmed', htmlLink: null, organizer: null,
		attendees: [], ...overrides
	};
}

describe('date keys', () => {
	it('validates date keys', () => {
		expect(isDateKey('2026-09-21')).toBe(true);
		expect(isDateKey('2026-02-30')).toBe(false);
		expect(isDateKey('2026-9-1')).toBe(false);
		expect(isDateKey(null)).toBe(false);
	});

	it('adds days and months across boundaries', () => {
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
		expect(addMonths('2026-01-31', 1)).toBe('2026-02-01');
		expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
	});

	it('starts weeks on Sunday', () => {
		expect(startOfWeek('2026-09-21')).toBe('2026-09-20');
		expect(startOfWeek('2026-09-20')).toBe('2026-09-20');
	});

	it('computes view ranges with whole weeks for the month grid', () => {
		expect(viewRange('day', '2026-09-21')).toEqual({ start: '2026-09-21', end: '2026-09-22' });
		expect(viewRange('week', '2026-09-21')).toEqual({ start: '2026-09-20', end: '2026-09-27' });
		expect(viewRange('month', '2026-09-21')).toEqual({ start: '2026-08-30', end: '2026-10-04' });
		expect(daysBetween('2026-08-30', '2026-10-04')).toHaveLength(35);
	});

	it('shifts views', () => {
		expect(shiftView('day', '2026-09-21', 1)).toBe('2026-09-22');
		expect(shiftView('week', '2026-09-21', -1)).toBe('2026-09-14');
		expect(shiftView('month', '2026-09-21', 1)).toBe('2026-10-01');
	});
});

describe('event placement', () => {
	it('matches events to the days they touch', () => {
		const timed = event({ startAt: '2026-09-21T22:00:00', endAt: '2026-09-22T01:00:00' });
		expect(eventOccursOn(timed, '2026-09-21')).toBe(true);
		expect(eventOccursOn(timed, '2026-09-22')).toBe(true);
		expect(eventOccursOn(timed, '2026-09-23')).toBe(false);

		const allDay = event({ startAt: '2026-09-21', endAt: '2026-09-23', allDay: true });
		expect(eventOccursOn(allDay, '2026-09-22')).toBe(true);
		expect(eventOccursOn(allDay, '2026-09-23')).toBe(false);

		const instant = event({ startAt: '2026-09-21T09:00:00', endAt: '2026-09-21T09:00:00' });
		expect(eventOccursOn(instant, '2026-09-21')).toBe(true);
	});

	it('sorts all-day events before timed events', () => {
		const events = [
			event({ startAt: '2026-09-21T09:00:00', endAt: '2026-09-21T10:00:00', summary: 'Late' }),
			event({ startAt: '2026-09-21T08:00:00', endAt: '2026-09-21T09:00:00', summary: 'Early' }),
			event({ startAt: '2026-09-21', endAt: '2026-09-22', allDay: true, summary: 'Holiday' })
		];
		expect(eventsOnDay(events, '2026-09-21').map((item) => item.summary)).toEqual(['Holiday', 'Early', 'Late']);
	});

	it('places overlapping timed events in side-by-side columns', () => {
		const events = [
			event({ startAt: '2026-09-21T09:00:00', endAt: '2026-09-21T10:00:00', summary: 'A' }),
			event({ startAt: '2026-09-21T09:30:00', endAt: '2026-09-21T11:00:00', summary: 'B' }),
			event({ startAt: '2026-09-21T10:00:00', endAt: '2026-09-21T10:30:00', summary: 'C' }),
			event({ startAt: '2026-09-21T13:00:00', endAt: '2026-09-21T14:00:00', summary: 'D' }),
			event({ startAt: '2026-09-21', endAt: '2026-09-22', allDay: true, summary: 'Skip' })
		];
		const layout = layoutTimedEvents(events, '2026-09-21')
			.map(({ event, startMinutes, endMinutes, column, columns }) => [event.summary, startMinutes, endMinutes, column, columns]);
		expect(layout).toEqual([
			['A', 540, 600, 0, 2],
			['B', 570, 660, 1, 2],
			['C', 600, 630, 0, 2],
			['D', 780, 840, 0, 1]
		]);
	});

	it('clips events that cross midnight', () => {
		const events = [event({ startAt: '2026-09-21T22:00:00', endAt: '2026-09-22T01:00:00' })];
		expect(layoutTimedEvents(events, '2026-09-21')[0]).toMatchObject({ startMinutes: 1320, endMinutes: 1440, continuesAfter: true, continuesBefore: false });
		expect(layoutTimedEvents(events, '2026-09-22')[0]).toMatchObject({ startMinutes: 0, endMinutes: 60, continuesAfter: false, continuesBefore: true });
	});
});

describe('calendar selection', () => {
	const calendar: SyncedCalendar = {
		accountEmail: 'owner@example.com', calendarId: 'primary', summary: 'Main',
		timeZone: null, backgroundColor: null, selected: true
	};

	it('parses stored overrides and ignores bad input', () => {
		expect(parseCalendarSelection(null)).toEqual({});
		expect(parseCalendarSelection('not json')).toEqual({});
		expect(parseCalendarSelection('[1]')).toEqual({});
		expect(parseCalendarSelection('{"a":true,"b":"no","c":false}')).toEqual({ a: true, c: false });
	});

	it('falls back to the Google selected flag', () => {
		expect(isCalendarVisible(calendar, {})).toBe(true);
		expect(isCalendarVisible({ ...calendar, selected: false }, {})).toBe(false);
		const hidden = setCalendarVisible({}, calendar, false);
		expect(isCalendarVisible(calendar, hidden)).toBe(false);
		expect(isCalendarVisible(calendar, setCalendarVisible(hidden, calendar, true))).toBe(true);
	});
});
