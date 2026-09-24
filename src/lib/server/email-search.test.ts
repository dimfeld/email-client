import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, getEmail, markArchived, markDeleted, upsertEmails } from './db';
import { searchEmailSummaries, searchEmails } from './email-search';

const directory = mkdtempSync(join(tmpdir(), 'mail-search-'));
let database = createDatabase(':memory:');
afterEach(() => {
  database.close();
  database = createDatabase(':memory:');
});

test('indexes all fields and keeps common words in exact phrases', () => {
  upsertEmails(database, 'owner@test.com', [
    {
      id: 'one',
      subject: 'Launch report',
      from: 'Alice <alice@team.example.com>',
      to: 'bob@test.com',
      bodyText: 'To be or not to be ready',
    },
    { id: 'two', bodyHtml: '<p>Budget <b>approval</b> is ready</p>' },
  ]);
  for (const query of ['launch', 'alice', 'bob', '"to be or not to be"', '"budget approval"'])
    expect(searchEmails(database, query)).toHaveLength(1);
  expect(searchEmails(database, '"to be ready or not"')).toHaveLength(0);
});

test('uses BM25 rank, preserves account scope, and searches archived mail', () => {
  upsertEmails(database, 'a@test.com', [
    { id: 'a', bodyText: 'kiwi kiwi kiwi' },
    { id: 'b', bodyText: 'kiwi ' + 'orange '.repeat(100) },
  ]);
  upsertEmails(database, 'b@test.com', [{ id: 'c', bodyText: 'kiwi' }]);
  markArchived(database, 'a@test.com', ['a']);
  const matches = searchEmails(database, 'kiwi', 'a@test.com');
  expect(matches.map((x) => x.gmailId)).toEqual(['a', 'b']);
  expect(getEmail(database, matches[0].id, 'b@test.com')).toBeNull();
  expect(searchEmailSummaries(database, 'kiwi', 'a@test.com').map((x) => x.id)).toEqual(
    matches.map((x) => x.id)
  );
  expect(searchEmailSummaries(database, 'kiwi', 'a@test.com')[0]).not.toHaveProperty('bodyText');
});

test('matches addresses and domains exactly and accepts RFC email dates', () => {
  upsertEmails(database, 'owner@test.com', [
    {
      id: 'a',
      from: 'Alice <alice@sub.example.com>',
      to: 'bob@test.com',
      date: 'Mon, 21 Sep 2026 12:00:00 +0000',
    },
    { id: 'b', from: 'Alice <alice@notexample.com>', date: '2026-09-20T23:00:00Z' },
  ]);
  expect(
    searchEmails(
      database,
      'from:example.com to:bob@test.com after:2026-09-21 before:2026-09-22'
    ).map((x) => x.gmailId)
  ).toEqual(['a']);
  expect(searchEmails(database, 'from:alice@sub.example.com')).toHaveLength(1);
  expect(() => searchEmails(database, 'after:2026-02-30')).toThrow('YYYY-MM-DD');
  expect(() => searchEmails(database, '"open quote')).toThrow('Close the quote');
  expect(searchEmails(database, '***')).toEqual([]);
});

test('filters recent mail by folder and label status', () => {
  upsertEmails(database, 'owner@test.com', [
    { id: 'inbox', labels: ['INBOX'], date: '2026-09-24T12:00:00Z' },
    { id: 'archive', labels: ['STARRED', 'IMPORTANT'], date: '2026-09-23T12:00:00Z' },
    { id: 'sent', labels: ['SENT'], date: '2026-09-22T12:00:00Z' },
  ]);
  for (const [folder, ids] of [
    ['inbox', ['inbox']],
    ['archive', ['archive']],
    ['sent', ['sent']],
    ['starred', ['archive']],
    ['important', ['archive']],
    ['all', ['inbox', 'archive', 'sent']],
  ] as const)
    expect(searchEmails(database, `in:${folder}`).map((email) => email.gmailId)).toEqual([...ids]);
  expect(() => searchEmails(database, 'in:unknown')).toThrow('Use inbox');
});

test('updates and deletes index rows with the stored message', () => {
  upsertEmails(database, 'a@test.com', [{ id: 'a', subject: 'before' }]);
  upsertEmails(database, 'a@test.com', [{ id: 'a', subject: 'after' }]);
  expect(searchEmails(database, 'before')).toHaveLength(0);
  expect(searchEmails(database, 'after')).toHaveLength(1);
  markDeleted(database, 'a@test.com', ['a']);
  expect(searchEmails(database, 'after')).toHaveLength(0);
  upsertEmails(database, 'a@test.com', [{ id: 'a', subject: 'restored' }]);
  expect(searchEmails(database, 'restored')).toHaveLength(1);
  database.exec('DELETE FROM emails');
  expect(searchEmails(database, 'restored')).toHaveLength(0);
});

test('indexes existing messages once when an older database opens', () => {
  const path = join(directory, 'migration.sqlite');
  const old = createDatabase(path);
  old.exec(
    'DROP TRIGGER email_fts_insert; DROP TRIGGER email_fts_update; DROP TRIGGER email_fts_delete; DROP TABLE email_fts'
  );
  upsertEmails(old, 'a@test.com', [{ id: 'a', subject: 'legacy' }]);
  old.close();
  const migrated = createDatabase(path);
  expect(searchEmails(migrated, 'legacy')).toHaveLength(1);
  migrated.close();
  const reopened = createDatabase(path);
  expect(searchEmails(reopened, 'legacy')).toHaveLength(1);
  reopened.close();
  rmSync(directory, { recursive: true, force: true });
});
