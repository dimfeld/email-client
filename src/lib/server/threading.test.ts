import { afterEach, expect, test } from 'bun:test';
import {
  createDatabase,
  changeEmailLabels,
  getThreadActionTargets,
  getThreadEmails,
  markDeleted,
  markUndeleted,
  upsertEmails,
} from './db';
import { rebuildThreads } from './thread-schema';
import { countMailFilters, listMail } from './mail-list';
import type { DatabaseSync } from 'node:sqlite';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let database: DatabaseSync | undefined;
afterEach(() => database?.close());

function setup() {
  database = createDatabase(':memory:');
  return database;
}
function rows(db: DatabaseSync, table: string) {
  return db
    .prepare(
      `SELECT * FROM ${table} ORDER BY account_email, thread_key, ${table === 'threads' ? 'latest_email_id' : table === 'thread_labels' ? 'label' : 'filter'}`
    )
    .all();
}

test('threads keep account boundaries, latest time, labels, and all stored members', () => {
  const db = setup();
  upsertEmails(db, 'one@example.com', [
    {
      id: 'one',
      threadId: 'shared',
      labels: ['INBOX', 'UNREAD'],
      date: '2024-01-01',
      subject: 'Hello',
    },
    { id: 'two', threadId: 'shared', labels: ['SENT'], date: '2024-01-02', subject: 'Re: Hello' },
  ]);
  upsertEmails(db, 'two@example.com', [
    { id: 'other', threadId: 'shared', labels: ['INBOX'], date: '2024-01-03' },
  ]);
  const inbox = listMail(db, { search: '', filter: 'all', limit: 10 });
  expect(inbox.emails).toHaveLength(2);
  expect(inbox.emails[1]).toMatchObject({
    id: 2,
    unread: true,
    latestSortTime: Date.parse('2024-01-02'),
  });
  expect(
    listMail(db, { view: 'sent', search: '', filter: 'all', limit: 10 }).emails.map((row) => row.id)
  ).toEqual([2]);
  expect(getThreadEmails(db, 1).map((email) => email.gmailId)).toEqual(['one', 'two']);
  expect(countMailFilters(db)).toMatchObject({ all: 2, pending: 2 });
});

test('label changes, thread ID changes, deletions, and rebuild keep derived rows equal', () => {
  const db = setup();
  upsertEmails(db, 'one@example.com', [
    { id: 'one', labels: ['INBOX'], date: 'bad date' },
    { id: 'two', threadId: 'thread', labels: ['SENT'], date: '2024-01-02' },
  ]);
  const fallback = db
    .prepare("SELECT thread_key, sort_time, first_seen_at FROM emails WHERE gmail_id = 'one'")
    .get() as { thread_key: string; sort_time: number; first_seen_at: string };
  expect(fallback.thread_key).toBe('m:one');
  expect(fallback.sort_time).toBe(Date.parse(fallback.first_seen_at));
  changeEmailLabels(db, 'one@example.com', ['one'], {
    removeLabelIds: ['INBOX'],
    addLabelIds: ['UNREAD'],
  });
  upsertEmails(db, 'one@example.com', [
    { id: 'one', threadId: 'thread', labels: ['INBOX', 'UNREAD'], date: 'bad date' },
  ]);
  markDeleted(db, 'one@example.com', ['two']);
  const localId = Number(db.prepare("SELECT id FROM emails WHERE gmail_id = 'one'").get()!.id);
  expect(getThreadActionTargets(db, localId, 'delete').map((row) => row.gmailId)).toEqual(['one']);
  markUndeleted(db, 'one@example.com', ['two']);
  db.prepare('DELETE FROM emails WHERE gmail_id = ?').run('two');
  const before = ['threads', 'thread_labels', 'thread_filters'].map((table) => rows(db, table));
  rebuildThreads(db);
  expect(['threads', 'thread_labels', 'thread_filters'].map((table) => rows(db, table))).toEqual(
    before
  );
  expect(rows(db, 'threads')).toHaveLength(1);
});

test('a latest archived member orders an Inbox thread and Sent-only threads stay in Sent', () => {
  const db = setup();
  upsertEmails(db, 'one@example.com', [
    { id: 'older', threadId: 'shared', labels: ['INBOX'], date: '2024-01-01' },
    { id: 'newer', threadId: 'shared', labels: [], date: '2024-01-03' },
    { id: 'sent-only', threadId: 'sent', labels: ['SENT'], date: '2024-01-02' },
  ]);
  expect(
    listMail(db, { search: '', filter: 'all', limit: 10 }).emails.map((row) => row.id)
  ).toEqual([2]);
  expect(
    listMail(db, { view: 'sent', search: '', filter: 'all', limit: 10 }).emails.map((row) => row.id)
  ).toEqual([3]);
  expect(getThreadEmails(db, 1).map((email) => email.gmailId)).toEqual(['older', 'newer']);
});

test('filters use any received member and search previews the matching member', () => {
  const db = setup();
  upsertEmails(db, 'one@example.com', [
    { id: 'one', threadId: 'thread', labels: ['INBOX'], date: '2024-01-01', subject: 'Needle' },
    { id: 'two', threadId: 'thread', labels: ['SENT'], date: '2024-01-02', subject: 'Reply' },
  ]);
  db.prepare("UPDATE emails SET category = 'action' WHERE gmail_id = 'one'").run();
  expect(listMail(db, { search: '', filter: 'action', limit: 10 }).emails[0]).toMatchObject({
    id: 2,
    category: 'action',
  });
  expect(countMailFilters(db)).toMatchObject({ all: 1, action: 1, important: 1, useful: 1 });
  expect(listMail(db, { search: 'Needle', filter: 'action', limit: 10 }).emails[0]).toMatchObject({
    id: 1,
    latestMessageId: 2,
  });
  db.prepare("UPDATE categories SET level = 'other' WHERE id = 'action'").run();
  expect(countMailFilters(db)).toMatchObject({ all: 1, action: 1 });
  expect(countMailFilters(db).important).toBeUndefined();
});

test('label-only upserts preserve classification and content changes retain the old result until replacement', () => {
  const db = setup();
  expect(upsertEmails(db, 'one@example.com', [{ id: 'archived-only', labels: [] }])).toHaveLength(
    0
  );
  expect(upsertEmails(db, 'one@example.com', [{ id: 'sent-only', labels: ['SENT'] }])).toHaveLength(
    0
  );
  const email = { id: 'one', labels: ['INBOX'], subject: 'First', bodyText: 'Text' };
  expect(upsertEmails(db, 'one@example.com', [email])).toHaveLength(1);
  db.prepare(
    "UPDATE emails SET category = 'action', classified_at = '2024-01-01', has_action_item = 1 WHERE gmail_id = 'one'"
  ).run();
  expect(upsertEmails(db, 'one@example.com', [{ ...email, labels: [] }])).toHaveLength(0);
  expect(
    db.prepare("SELECT category, classified_at FROM emails WHERE gmail_id = 'one'").get()
  ).toMatchObject({ category: 'action', classified_at: '2024-01-01' });
  expect(
    upsertEmails(db, 'one@example.com', [{ ...email, labels: [], subject: 'Changed' }])
  ).toHaveLength(1);
  expect(
    db
      .prepare("SELECT category, classified_at, has_action_item FROM emails WHERE gmail_id = 'one'")
      .get()
  ).toMatchObject({ category: 'action', classified_at: null, has_action_item: 1 });
});

test('migration moves archived state to labels before dropping the column', () => {
  const path = join(tmpdir(), `email-thread-migration-${randomUUID()}.sqlite`);
  let db = createDatabase(path);
  upsertEmails(db, 'one@example.com', [{ id: 'one', labels: ['INBOX'], date: '2024-01-01' }]);
  db.exec(
    "ALTER TABLE emails ADD COLUMN archived_at TEXT; UPDATE emails SET archived_at = '2024-01-02'"
  );
  db.close();
  db = createDatabase(path);
  expect(db.prepare("SELECT labels_json FROM emails WHERE gmail_id = 'one'").get()).toMatchObject({
    labels_json: '[]',
  });
  expect(
    (db.prepare('PRAGMA table_info(emails)').all() as { name: string }[]).some(
      (column) => column.name === 'archived_at'
    )
  ).toBe(false);
  expect(listMail(db, { search: '', filter: 'all', limit: 10 }).emails).toEqual([]);
  db.close();
  rmSync(path, { force: true });
  database = undefined;
});
