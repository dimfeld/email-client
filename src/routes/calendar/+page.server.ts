import { getDatabase, listCalendars, listCalendarEventsBetween } from '$lib/server/db';
import { dateKeyFromDate, defaultCalendarView, isCalendarView, isDateKey, viewRange } from '$lib/calendar';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, depends, setHeaders }) => {
	depends('app:state');
	setHeaders({ 'cache-control': 'no-store' });
	const requestedView = url.searchParams.get('view');
	const view = isCalendarView(requestedView) ? requestedView : defaultCalendarView;
	const requestedDate = url.searchParams.get('date');
	const date = isDateKey(requestedDate) ? requestedDate : dateKeyFromDate(new Date());
	const range = viewRange(view, date);
	const database = getDatabase();
	return {
		view,
		date,
		range,
		calendars: listCalendars(database),
		events: listCalendarEventsBetween(database, range.start, range.end)
	};
};
