import { getDatabase, listAccounts, listCalendars, listCalendarEventsBetween } from '$lib/server/db';
import { dateKeyFromDate, defaultCalendarView, isCalendarView, isDateKey, viewRange } from '$lib/calendar';
import { fail } from '@sveltejs/kit';
import { respondToCalendarInvite } from '$lib/server/calendar-response';
import type { Actions, PageServerLoad } from './$types';

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

export const actions: Actions = {
	respond: async ({ request }) => {
		const fields = await request.formData();
		const database = getDatabase();
		const account = listAccounts(database).find(item => item.email === fields.get('account'));
		if (!account?.refreshToken) return fail(400, { error: 'Reconnect the account in Settings before replying.' });
		if (fields.get('confirmed') !== 'yes') return fail(400, { error: 'Review and confirm the calendar response.' });
		try {
			const responseStatus = await respondToCalendarInvite(database, account, String(fields.get('calendar') ?? ''), String(fields.get('event') ?? ''), String(fields.get('response') ?? ''));
			return { message: 'Calendar response sent.', responseStatus };
		} catch (error) {
			return fail(502, { error: error instanceof Error ? error.message : 'Calendar response failed.' });
		}
	}
};
