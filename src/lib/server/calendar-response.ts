import type { DatabaseSync } from 'node:sqlite';
import { getCalendarEvent, saveCalendarResponse } from './db';
import { googleApiRequest, GoogleApiError, type GoogleAccount } from './google-api';
import { canRespondToEvent, isCalendarResponse } from '$lib/calendar-response';

type RemoteEvent = { id?: string; etag?: string; status?: string; attendees?: { email?: string; self?: boolean; organizer?: boolean; responseStatus?: string }[] };

export async function respondToCalendarInvite(database: DatabaseSync, account: GoogleAccount, calendarId: string, eventId: string, response: string, request = googleApiRequest) {
	if (!isCalendarResponse(response)) throw new Error('Choose Accept, Tentative, or Decline.');
	const stored = getCalendarEvent(database, account.email, calendarId, eventId);
	if (!stored || !canRespondToEvent(stored)) throw new Error('This event is not an invitation on your own calendar.');
	const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
	try {
		const event = await request<RemoteEvent>(account, url);
		if (event.id !== eventId || event.status === 'cancelled') throw new Error('This invitation is no longer available.');
		const attendee = event.attendees?.find(item => item.self && item.email?.toLowerCase() === account.email.toLowerCase() && !item.organizer);
		if (!attendee) throw new Error('The connected account is not the invited attendee.');
		if (!event.etag) throw new Error('Google did not return an event version. Refresh the calendar and try again.');
		if (attendee.responseStatus === response) {
			saveCalendarResponse(database, account.email, calendarId, eventId, response);
			return response;
		}
		// attendeesOmitted updates only this participant, without replacing the guest list.
		const updated = await request<RemoteEvent>(account, url, {
			method: 'PATCH', params: { sendUpdates: 'all' }, headers: { 'If-Match': event.etag },
			data: { attendeesOmitted: true, attendees: [{ email: attendee.email, responseStatus: response }] }
		});
		const actual = updated.attendees?.find(item => item.email?.toLowerCase() === account.email.toLowerCase())?.responseStatus;
		if (!actual) throw new Error('Google did not confirm your response. Refresh the calendar to check its status.');
		saveCalendarResponse(database, account.email, calendarId, eventId, actual);
		if (actual !== response) throw new Error(`Google returned the response ${actual}. Refresh the calendar before trying again.`);
		return actual;
	} catch (error) {
		if (error instanceof GoogleApiError && error.status === 403) throw new Error('Calendar write access is required. Reconnect this account in Settings and grant Calendar access, then try again.');
		if (error instanceof GoogleApiError && error.status === 412) throw new Error('The event changed while you replied. Refresh the calendar and review it before trying again.');
		throw error;
	}
}
