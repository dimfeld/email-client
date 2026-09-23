import { afterEach, expect, it } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { createDatabase, markArchived, saveClassification, upsertEmails } from './db';
import { listMail } from './mail-list';
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
  classify('a', 'action', null); // level important
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
  expect(listMail(db, { search: '', filter: 'work', limit: 100 }).counts).toEqual({
    all: 4,
    important: 2,
    useful: 3,
    pending: 1,
    action: 1,
    work: 1,
    newsletter: 1,
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
  expect(result.counts.all).toBe(5);
  expect(listMail(db, { search: '***', filter: 'all', limit: 100 })).toEqual({
    emails: [],
    hasMore: false,
    counts: { all: 0, important: 0, useful: 0, pending: 0 },
  });
});
