import { afterEach, expect, it } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { createDatabase, markArchived, saveClassification, upsertEmails } from './db';
import { countMailFilters, listMail } from './mail-list';
import type { Importance } from '$lib/categories';

let database: DatabaseSync | undefined;
afterEach(() => {
  database?.close();
  database = undefined;
});

function classify(id: string, category: string, importance: Importance | null) {
  saveClassification(database!, 'one@example.com', id, {
    category,
    importance,
    model: 'test',
    categoryConfidence: 1,
    importanceConfidence: null,
    categoryProbabilities: { [category]: 1 },
    importanceProbabilities: {},
    hasActionItem: false,
    actionItemProbability: 0,
    hasReminder: false,
    reminderProbability: 0,
  });
}

function setup() {
  database = createDatabase(':memory:');
  upsertEmails(
    database,
    'one@example.com',
    ['a', 'b', 'c', 'd', 'e'].map((id, index) => ({
      id,
      subject: `Message ${id} kiwi`,
      date: new Date(Date.UTC(2026, 0, 10 - index)).toUTCString(),
      labels: ['INBOX'],
    }))
  );
  classify('a', 'action', 'important'); // the fixed level is stored
  classify('b', 'work', 'useful'); // auto, so the message level counts
  classify('c', 'work', 'other');
  classify('d', 'newsletter', 'important');
  // e stays unclassified
  return database;
}

const subjects = (result: ReturnType<typeof listMail>) =>
  result.emails.map((email) => email.subject.split(' ')[1]);

it('filters by effective importance, category, and missing classification in SQL', () => {
  const db = setup();
  const list = (filter: string) => subjects(listMail(db, { search: '', filter, limit: 100 }));
  expect(list('all')).toEqual(['a', 'b', 'c', 'd', 'e']);
  expect(list('important')).toEqual(['a', 'd']);
  expect(list('useful')).toEqual(['a', 'b', 'd']);
  expect(list('work')).toEqual(['b', 'c']);
  expect(list('pending')).toEqual(['e']);
});

it('counts every filter before the filter applies', () => {
  const db = setup();
  markArchived(db, 'one@example.com', ['c']);
  expect(countMailFilters(db)).toEqual({
    all: 4,
    important: 2,
    useful: 3,
    pending: 1,
    action: 1,
    work: 1,
    newsletter: 1,
  });
});

it('counts messages with different levels in one auto category separately', () => {
  const db = setup();
  expect(countMailFilters(db)).toMatchObject({
    important: 2,
    useful: 3,
    work: 2,
  });
});

it('returns one page and says whether more rows exist', () => {
  const db = setup();
  const first = listMail(db, { search: '', filter: 'all', limit: 2 });
  expect(subjects(first)).toEqual(['a', 'b']);
  expect(first.hasMore).toBe(true);
  const all = listMail(db, { search: '', filter: 'all', limit: 5 });
  expect(all.hasMore).toBe(false);
});

it('applies filters and counts to search results', () => {
  const db = setup();
  const result = listMail(db, { search: 'kiwi', filter: 'important', limit: 100 });
  expect(subjects(result).sort()).toEqual(['a', 'd']);
  expect(countMailFilters(db, undefined, 'kiwi').all).toBe(5);
  expect(listMail(db, { search: '***', filter: 'all', limit: 100 })).toEqual({
    emails: [],
    hasMore: false,
    counts: {},
  });
});

it('marks threads that have a starred message', () => {
  setup();
  upsertEmails(database!, 'one@example.com', [
    {
      id: 'b',
      subject: 'Message b kiwi',
      date: new Date(Date.UTC(2026, 0, 9)).toUTCString(),
      labels: ['INBOX', 'STARRED'],
    },
  ]);
  const emails = listMail(database!, { search: '', filter: 'all', limit: 10 }).emails;
  expect(emails.filter((email) => email.starred).map((email) => email.subject)).toEqual([
    'Message b kiwi',
  ]);
});

it('lists starred threads first in the inbox and its filters, but not in Sent', () => {
  setup();
  const day = (date: number) => new Date(Date.UTC(2026, 0, date)).toUTCString();
  upsertEmails(database!, 'one@example.com', [
    { id: 'd', subject: 'Message d kiwi', date: day(7), labels: ['INBOX', 'STARRED'] },
    { id: 'f', subject: 'Message f kiwi', date: day(12), labels: ['SENT'] },
    { id: 'g', subject: 'Message g kiwi', date: day(11), labels: ['SENT', 'STARRED'] },
  ]);
  const list = (filter: string, view?: 'sent', limit = 10) =>
    subjects(listMail(database!, { search: '', filter, view, limit }));
  expect(list('all')).toEqual(['d', 'a', 'b', 'c', 'e']);
  expect(list('important')).toEqual(['d', 'a']);
  expect(list('all', 'sent')).toEqual(['f', 'g']);
  // The starred thread is in the first page too.
  expect(list('all', undefined, 1)).toEqual(['d']);
});
