import { afterEach, expect, test } from 'bun:test';
import {
  applyCalendarEventsIncrementalSync,
  createDatabase,
  getCalendarEvent,
  ignoreCalendarInvite,
  listPendingCalendarInvites,
  replaceCalendars,
  upsertAccount,
} from './db';
import { respondToCalendarInvite } from './calendar-response';
import { GoogleApiError, type googleApiRequest } from './google-api';
import { normalizeCalendarEvent } from './google-sync';

const database = createDatabase(':memory:');
const account = { email: 'me@test.com', refreshToken: 'test' };
const remote = {
  id: 'invite/one',
  etag: 'version-1',
  summary: 'Planning',
  status: 'confirmed',
  start: { dateTime: '2026-09-23T12:00:00Z' },
  end: { dateTime: '2026-09-23T13:00:00Z' },
  organizer: { email: 'host@test.com' },
  attendees: [
    { email: account.email, self: true, responseStatus: 'needsAction' },
    { email: 'other@test.com', responseStatus: 'accepted' },
  ],
};
function seed() {
  upsertAccount(database, account);
  replaceCalendars(
    database,
    account.email,
    [
      {
        calendarId: account.email,
        summary: 'Mine',
        timeZone: 'UTC',
        backgroundColor: null,
        selected: true,
      },
    ],
    [normalizeCalendarEvent(remote, account.email)]
  );
}
afterEach(() => database.exec('DELETE FROM calendars; DELETE FROM ignored_calendar_invites'));

test('lists pending invitations and keeps ignored ones hidden after a calendar sync', () => {
  seed();
  expect(listPendingCalendarInvites(database).map((event) => event.eventId)).toEqual([remote.id]);
  expect(ignoreCalendarInvite(database, account.email, account.email, remote.id)).toBe(true);
  expect(listPendingCalendarInvites(database)).toEqual([]);
  replaceCalendars(
    database,
    account.email,
    [
      {
        calendarId: account.email,
        summary: 'Mine',
        timeZone: 'UTC',
        backgroundColor: null,
        selected: true,
      },
    ],
    [normalizeCalendarEvent(remote, account.email)]
  );
  expect(listPendingCalendarInvites(database)).toEqual([]);
  expect(getCalendarEvent(database, account.email, account.email, remote.id)?.responseStatus).toBe(
    'needsAction'
  );
  expect(ignoreCalendarInvite(database, account.email, account.email, 'missing')).toBe(false);
});

for (const response of ['accepted', 'tentative', 'declined'])
  test(`sends ${response} only for the owner and saves the confirmed response`, async () => {
    seed();
    const calls: Parameters<typeof googleApiRequest>[] = [];
    const request = (async (...args: Parameters<typeof googleApiRequest>) => {
      calls.push(args);
      return args[2]?.method === 'PATCH'
        ? { ...remote, attendees: [{ ...remote.attendees[0], responseStatus: response }] }
        : remote;
    }) as typeof googleApiRequest;
    await respondToCalendarInvite(database, account, account.email, remote.id, response, request);
    expect(calls[1][1]).toContain('invite%2Fone');
    expect(calls[1][2]).toEqual({
      method: 'PATCH',
      params: { sendUpdates: 'all' },
      headers: { 'If-Match': 'version-1' },
      data: {
        attendeesOmitted: true,
        attendees: [{ email: account.email, responseStatus: response }],
      },
    });
    expect(
      getCalendarEvent(database, account.email, account.email, remote.id)?.responseStatus
    ).toBe(response);
  });

test('rejects cancelled events, missing attendees, and invalid responses without writing', async () => {
  seed();
  for (const current of [
    { ...remote, status: 'cancelled' },
    { ...remote, attendees: [{ email: 'someone@test.com', self: true }] },
  ]) {
    let calls = 0;
    const request = (async () => {
      calls++;
      return current;
    }) as typeof googleApiRequest;
    await expect(
      respondToCalendarInvite(database, account, account.email, remote.id, 'accepted', request)
    ).rejects.toThrow();
    expect(calls).toBe(1);
  }
  await expect(
    respondToCalendarInvite(database, account, account.email, remote.id, 'bad')
  ).rejects.toThrow('Choose');
  expect(getCalendarEvent(database, account.email, account.email, remote.id)?.responseStatus).toBe(
    'needsAction'
  );
});

test('keeps local state on a failed write and explains reconnect or stale event errors', async () => {
  seed();
  for (const [status, message] of [
    [403, 'Reconnect'],
    [412, 'event changed'],
  ] as const) {
    const request = (async (_account, _url, options) => {
      if (options?.method === 'PATCH') throw new GoogleApiError('failure', status);
      return remote;
    }) as typeof googleApiRequest;
    await expect(
      respondToCalendarInvite(database, account, account.email, remote.id, 'accepted', request)
    ).rejects.toThrow(message);
    expect(
      getCalendarEvent(database, account.email, account.email, remote.id)?.responseStatus
    ).toBe('needsAction');
  }
});

test('normal sync keeps the attendee response status', () => {
  seed();
  applyCalendarEventsIncrementalSync(
    database,
    account.email,
    account.email,
    [
      normalizeCalendarEvent(
        { ...remote, attendees: [{ ...remote.attendees[0], responseStatus: 'tentative' }] },
        account.email
      ),
    ],
    [],
    'next',
    false
  );
  expect(getCalendarEvent(database, account.email, account.email, remote.id)?.responseStatus).toBe(
    'tentative'
  );
});
