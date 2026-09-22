import type { SyncedCalendar, SyncedCalendarEvent } from '$lib/server/types';

export type CalendarView = 'day' | 'week' | 'month';
export const calendarViews: readonly CalendarView[] = ['day', 'week', 'month'];
export const defaultCalendarView: CalendarView = 'month';

/** A calendar date with no time zone, formatted as YYYY-MM-DD. */
export type DateKey = string;

export type DateRange = { start: DateKey; end: DateKey };

export function isCalendarView(value: string | null): value is CalendarView {
	return calendarViews.includes(value as CalendarView);
}

export function isDateKey(value: string | null): value is DateKey {
	if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value);
}

export function dateKeyFromDate(date: Date): DateKey {
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}

function parts(key: DateKey): [number, number, number] {
	const [year, month, day] = key.split('-').map(Number);
	return [year, month, day];
}

function fromUtc(date: Date): DateKey {
	return date.toISOString().slice(0, 10);
}

export function addDays(key: DateKey, days: number): DateKey {
	const [year, month, day] = parts(key);
	return fromUtc(new Date(Date.UTC(year, month - 1, day + days)));
}

export function addMonths(key: DateKey, months: number): DateKey {
	const [year, month] = parts(key);
	return fromUtc(new Date(Date.UTC(year, month - 1 + months, 1)));
}

export function startOfMonth(key: DateKey): DateKey {
	return `${key.slice(0, 7)}-01`;
}

/** Weeks start on Sunday. */
export function startOfWeek(key: DateKey): DateKey {
	const [year, month, day] = parts(key);
	return addDays(key, -new Date(Date.UTC(year, month - 1, day)).getUTCDay());
}

export function daysBetween(start: DateKey, endExclusive: DateKey): DateKey[] {
	const days: DateKey[] = [];
	for (let key = start; key < endExclusive; key = addDays(key, 1)) days.push(key);
	return days;
}

/** The days a view shows around `key`. The end is exclusive. The month view fills whole weeks. */
export function viewRange(view: CalendarView, key: DateKey): DateRange {
	switch (view) {
		case 'day': return { start: key, end: addDays(key, 1) };
		case 'week': { const start = startOfWeek(key); return { start, end: addDays(start, 7) }; }
		case 'month': {
			const first = startOfMonth(key);
			const start = startOfWeek(first);
			const last = addDays(addMonths(first, 1), -1);
			return { start, end: addDays(startOfWeek(last), 7) };
		}
	}
}

export function shiftView(view: CalendarView, key: DateKey, direction: -1 | 1): DateKey {
	switch (view) {
		case 'day': return addDays(key, direction);
		case 'week': return addDays(key, direction * 7);
		case 'month': return addMonths(key, direction);
	}
}

export function calendarKey(accountEmail: string, calendarId: string): string {
	return `${accountEmail}\0${calendarId}`;
}

export function eventCalendarKey(event: Pick<SyncedCalendarEvent, 'accountEmail' | 'calendarId'>): string {
	return calendarKey(event.accountEmail, event.calendarId);
}

export function eventKey(event: SyncedCalendarEvent): string {
	return `${event.accountEmail}\0${event.calendarId}\0${event.eventId}`;
}

/** Milliseconds since the epoch in the browser's time zone. All-day dates become local midnight. */
export function localTime(value: string, allDay: boolean): number {
	return new Date(allDay ? `${value}T00:00:00` : value).valueOf();
}

export type Interval = { start: number; end: number };

export function eventInterval(event: Pick<SyncedCalendarEvent, 'startAt' | 'endAt' | 'allDay'>): Interval {
	const start = localTime(event.startAt, event.allDay);
	return { start, end: Math.max(start, localTime(event.endAt, event.allDay)) };
}

export function dayInterval(key: DateKey): Interval {
	return { start: localTime(key, true), end: localTime(addDays(key, 1), true) };
}

/** Whether an event touches a day. A zero-length event counts on the day it starts. */
export function eventOccursOn(event: SyncedCalendarEvent, key: DateKey): boolean {
	const day = dayInterval(key);
	const { start, end } = eventInterval(event);
	if (start === end) return start >= day.start && start < day.end;
	return start < day.end && end > day.start;
}

export function compareEvents(a: SyncedCalendarEvent, b: SyncedCalendarEvent): number {
	if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
	const left = eventInterval(a);
	const right = eventInterval(b);
	return left.start - right.start || right.end - left.end || a.summary.localeCompare(b.summary);
}

export function eventsOnDay(events: SyncedCalendarEvent[], key: DateKey): SyncedCalendarEvent[] {
	return events.filter((event) => eventOccursOn(event, key)).sort(compareEvents);
}

export type TimedPlacement = {
	event: SyncedCalendarEvent;
	/** Minutes after local midnight where the block starts, clipped to the day. */
	startMinutes: number;
	/** Minutes after local midnight where the block ends, clipped to the day. */
	endMinutes: number;
	column: number;
	columns: number;
	continuesBefore: boolean;
	continuesAfter: boolean;
};

const minute = 60_000;

/** Places timed events into side-by-side columns when they overlap within a day. */
export function layoutTimedEvents(events: SyncedCalendarEvent[], key: DateKey): TimedPlacement[] {
	const day = dayInterval(key);
	const dayMinutes = (day.end - day.start) / minute;
	const timed = events.filter((event) => !event.allDay && eventOccursOn(event, key)).sort(compareEvents);
	const placements: TimedPlacement[] = [];
	let cluster: TimedPlacement[] = [];
	let columnEnds: number[] = [];
	let clusterEnd = -Infinity;

	function closeCluster() {
		for (const placement of cluster) placement.columns = columnEnds.length;
		cluster = [];
		columnEnds = [];
	}

	for (const event of timed) {
		const interval = eventInterval(event);
		const startMinutes = Math.max(0, (interval.start - day.start) / minute);
		const endMinutes = Math.min(dayMinutes, Math.max(startMinutes, (interval.end - day.start) / minute));
		if (startMinutes >= clusterEnd) closeCluster();
		let column = columnEnds.findIndex((end) => end <= startMinutes);
		if (column === -1) column = columnEnds.length;
		columnEnds[column] = Math.max(endMinutes, startMinutes + 1);
		clusterEnd = Math.max(clusterEnd, columnEnds[column]);
		const placement: TimedPlacement = {
			event, startMinutes, endMinutes, column, columns: 1,
			continuesBefore: interval.start < day.start, continuesAfter: interval.end > day.end
		};
		cluster.push(placement);
		placements.push(placement);
	}
	closeCluster();
	return placements;
}

/** Local storage key for per-calendar visibility overrides. */
export const calendarSelectionStorageKey = 'calendar:visible-calendars';

/** Visibility overrides keyed by `calendarKey`. Calendars without an entry use the Google `selected` flag. */
export type CalendarSelection = Record<string, boolean>;

export function parseCalendarSelection(raw: string | null): CalendarSelection {
	if (!raw) return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'boolean')) as CalendarSelection;
	} catch {
		return {};
	}
}

export function isCalendarVisible(calendar: SyncedCalendar, selection: CalendarSelection): boolean {
	return selection[calendarKey(calendar.accountEmail, calendar.calendarId)] ?? calendar.selected;
}

export function setCalendarVisible(selection: CalendarSelection, calendar: SyncedCalendar, visible: boolean): CalendarSelection {
	return { ...selection, [calendarKey(calendar.accountEmail, calendar.calendarId)]: visible };
}
