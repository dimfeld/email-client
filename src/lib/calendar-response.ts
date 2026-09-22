import type { SyncedCalendarEvent } from '$lib/server/types';
export const calendarResponses = {
  accepted: 'Accept',
  tentative: 'Tentative',
  declined: 'Decline',
} as const;
export type CalendarResponse = keyof typeof calendarResponses;
export function isCalendarResponse(value: string): value is CalendarResponse {
  return Object.hasOwn(calendarResponses, value);
}
export function canRespondToEvent(event: SyncedCalendarEvent): boolean {
  return (
    event.status !== 'cancelled' &&
    event.organizer?.toLowerCase() !== event.accountEmail.toLowerCase() &&
    event.attendees.some((email) => email.toLowerCase() === event.accountEmail.toLowerCase()) &&
    (event.calendarId === 'primary' ||
      event.calendarId.toLowerCase() === event.accountEmail.toLowerCase())
  );
}
