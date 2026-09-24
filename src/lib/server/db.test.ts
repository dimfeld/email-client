import { afterEach, describe, expect, it } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyCalendarEventsIncrementalSync,
  applyCalendarListIncrementalSync,
  createDatabase,
  getEmail,
  getGoogleSyncState,
  listAccounts,
  listCalendarEventsBetween,
  listEmailSummaries,
  listEmails,
  populateAccountDisplayName,
  setAccountAlias,
  setAccountDisplayName,
  upsertAccount,
  upsertEmails,
} from './db';

let database: DatabaseSync | undefined;
let directory: string | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('email body storage', () => {
  it('returns small inbox summaries and loads the body for one selected message', () => {
    database = createDatabase(':memory:');
    upsertEmails(database, 'one@example.com', [
      {
        id: 'message',
        labels: ['INBOX'],
        subject: 'Hello',
        snippet: 'Preview',
        bodyText: 'Private body',
        bodyHtml: '<p>Private body</p>',
      },
    ]);
    const [summary] = listEmailSummaries(database);
    expect(summary).toMatchObject({ subject: 'Hello', snippet: 'Preview' });
    expect(summary).not.toHaveProperty('bodyText');
    expect(summary).not.toHaveProperty('bodyHtml');
    expect(getEmail(database, summary.id)?.bodyHtml).toBe('<p>Private body</p>');
  });
  it('stores plain text and HTML separately', () => {
    database = createDatabase(':memory:');
    upsertEmails(database, 'one@example.com', [
      {
        id: 'message',
        labels: ['INBOX'],
        bodyText: 'Readable text',
        bodyHtml: '<p style="color:red">Styled HTML</p>',
      },
    ]);

    expect(listEmails(database)[0]).toMatchObject({
      bodyText: 'Readable text',
      bodyHtml: '<p style="color:red">Styled HTML</p>',
    });
  });

  it('migrates a legacy body without losing HTML', () => {
    directory = mkdtempSync(join(tmpdir(), 'email-check-body-migration-'));
    const path = join(directory, 'test.sqlite');
    database = createDatabase(path);
    upsertEmails(database, 'one@example.com', [{ id: 'message', labels: ['INBOX'] }]);
    database.exec(`DROP TRIGGER email_fts_insert; DROP TRIGGER email_fts_update; DROP TRIGGER email_fts_delete; DROP TABLE email_fts;
			ALTER TABLE emails ADD COLUMN body TEXT NOT NULL DEFAULT '';
			UPDATE emails SET body = '<html><body><p style="color:red">Legacy</p></body></html>';
			ALTER TABLE emails DROP COLUMN body_text;
			ALTER TABLE emails DROP COLUMN body_html;`);
    database.close();

    database = createDatabase(path);
    expect(listEmails(database)[0]).toMatchObject({
      bodyText: '',
      bodyHtml: '<html><body><p style="color:red">Legacy</p></body></html>',
    });
  });
});

describe('email classification storage', () => {
  it('adds classification and extraction fields to an existing database', () => {
    directory = mkdtempSync(join(tmpdir(), 'email-check-classification-migration-'));
    const path = join(directory, 'test.sqlite');
    database = createDatabase(path);
    database.exec(`ALTER TABLE emails DROP COLUMN has_action_item;
			ALTER TABLE emails DROP COLUMN action_item_probability;
			ALTER TABLE emails DROP COLUMN has_reminder;
			ALTER TABLE emails DROP COLUMN reminder_probability;
			ALTER TABLE emails DROP COLUMN action_items_json;
			ALTER TABLE emails DROP COLUMN reminders_json;
			ALTER TABLE emails DROP COLUMN extraction_model;
			ALTER TABLE emails DROP COLUMN extraction_error;
			ALTER TABLE emails DROP COLUMN extracted_at;`);
    database.close();

    database = createDatabase(path);
    const columns = database.prepare('PRAGMA table_info(emails)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'has_action_item',
        'action_item_probability',
        'has_reminder',
        'reminder_probability',
        'action_items_json',
        'reminders_json',
        'extraction_model',
        'extraction_error',
        'extracted_at',
      ])
    );
  });
});

describe('Google OAuth account migration', () => {
  it('adds a name to existing accounts and keeps a name set by the user', () => {
    directory = mkdtempSync(join(tmpdir(), 'email-check-account-name-migration-'));
    const path = join(directory, 'test.sqlite');
    database = createDatabase(path);
    upsertAccount(database, { email: 'owner@example.com', refreshToken: 'token' });
    database.exec('ALTER TABLE accounts DROP COLUMN display_name');
    database.close();

    database = createDatabase(path);
    expect(listAccounts(database)[0].displayName).toBeNull();
    populateAccountDisplayName(database, 'owner@example.com', 'Google Name');
    expect(listAccounts(database)[0].displayName).toBe('Google Name');
    setAccountDisplayName(database, 'owner@example.com', 'Preferred Name');
    upsertAccount(database, { email: 'owner@example.com', displayName: 'Changed Google Name' });
    populateAccountDisplayName(database, 'owner@example.com', 'Changed Google Name');
    expect(listAccounts(database)[0].displayName).toBe('Preferred Name');
  });

  it('adds an alias column to existing accounts and clears a blank alias', () => {
    directory = mkdtempSync(join(tmpdir(), 'email-check-account-alias-migration-'));
    const path = join(directory, 'test.sqlite');
    database = createDatabase(path);
    upsertAccount(database, { email: 'owner@example.com', refreshToken: 'token' });
    database.exec('ALTER TABLE accounts DROP COLUMN alias');
    database.close();

    database = createDatabase(path);
    expect(listAccounts(database)[0].alias).toBeNull();
    setAccountAlias(database, 'owner@example.com', ' Work ');
    expect(listAccounts(database)[0].alias).toBe('Work');
    setAccountAlias(database, 'owner@example.com', '  ');
    expect(listAccounts(database)[0].alias).toBeNull();
  });

  it('adds refresh-token storage to a database created by the gog integration', () => {
    directory = mkdtempSync(join(tmpdir(), 'email-check-oauth-migration-'));
    const path = join(directory, 'test.sqlite');
    database = createDatabase(path);
    database.exec(`ALTER TABLE accounts DROP COLUMN google_refresh_token;
			ALTER TABLE accounts ADD COLUMN gog_client TEXT NOT NULL DEFAULT 'default';`);
    database.close();

    database = createDatabase(path);
    upsertAccount(database, { email: 'owner@example.com', refreshToken: 'refresh-token' });
    expect(listAccounts(database)[0]).toMatchObject({
      email: 'owner@example.com',
      refreshToken: 'refresh-token',
    });
  });

  it('adds incremental sync storage to an existing database', () => {
    directory = mkdtempSync(join(tmpdir(), 'email-check-sync-migration-'));
    const path = join(directory, 'test.sqlite');
    database = createDatabase(path);
    database.exec(`ALTER TABLE accounts DROP COLUMN contacts_sync_token;
			ALTER TABLE accounts DROP COLUMN calendar_list_sync_token;
			ALTER TABLE calendars DROP COLUMN sync_token;
			ALTER TABLE google_sync_progress DROP COLUMN next_sync_token;
			ALTER TABLE google_sync_calendars DROP COLUMN sync_token;`);
    database.close();

    database = createDatabase(path);
    upsertAccount(database, { email: 'owner@example.com', refreshToken: 'refresh-token' });
    expect(getGoogleSyncState(database, 'owner@example.com')).toMatchObject({
      contactsSyncToken: null,
      calendarListSyncToken: null,
    });
  });

  it('restarts contact sync when adding photo storage', () => {
    directory = mkdtempSync(join(tmpdir(), 'email-check-photo-migration-'));
    const path = join(directory, 'test.sqlite');
    database = createDatabase(path);
    upsertAccount(database, { email: 'owner@example.com', refreshToken: 'token' });
    database.exec(`UPDATE accounts SET contacts_sync_token = 'old-contacts',
      other_contacts_sync_token = 'old-other' WHERE email = 'owner@example.com';`);
    for (const table of [
      'contacts',
      'other_contacts',
      'google_sync_contacts',
      'google_sync_other_contacts',
    ]) {
      database.exec(`ALTER TABLE ${table} DROP COLUMN photo_url`);
    }
    database.close();

    database = createDatabase(path);
    expect(getGoogleSyncState(database, 'owner@example.com')).toMatchObject({
      contactsSyncToken: null,
      otherContactsSyncToken: null,
    });
  });
});

describe('calendar event range listing', () => {
  it('returns events that may touch the requested days', () => {
    database = createDatabase(':memory:');
    upsertAccount(database, { email: 'owner@example.com', refreshToken: 'token' });
    applyCalendarListIncrementalSync(
      database,
      'owner@example.com',
      [
        {
          calendarId: 'primary',
          summary: 'Main',
          timeZone: null,
          backgroundColor: null,
          selected: true,
        },
      ],
      [],
      'list-token'
    );
    const base = {
      calendarId: 'primary',
      summary: '',
      description: null,
      location: null,
      status: 'confirmed',
      htmlLink: null,
      organizer: null,
      attendees: [],
    };
    applyCalendarEventsIncrementalSync(
      database,
      'owner@example.com',
      'primary',
      [
        {
          ...base,
          eventId: 'before',
          startAt: '2026-09-10T09:00:00-07:00',
          endAt: '2026-09-10T10:00:00-07:00',
          allDay: false,
        },
        {
          ...base,
          eventId: 'edge',
          startAt: '2026-09-19T23:00:00-07:00',
          endAt: '2026-09-20T00:30:00-07:00',
          allDay: false,
        },
        {
          ...base,
          eventId: 'inside',
          startAt: '2026-09-21T09:00:00-07:00',
          endAt: '2026-09-21T10:00:00-07:00',
          allDay: false,
        },
        { ...base, eventId: 'spanning', startAt: '2026-09-01', endAt: '2026-10-01', allDay: true },
        {
          ...base,
          eventId: 'after',
          startAt: '2026-09-28T09:00:00-07:00',
          endAt: '2026-09-28T10:00:00-07:00',
          allDay: false,
        },
      ],
      [],
      'events-token',
      true
    );

    expect(
      listCalendarEventsBetween(database, '2026-09-20', '2026-09-27').map((event) => event.eventId)
    ).toEqual(['spanning', 'edge', 'inside']);
  });
});
