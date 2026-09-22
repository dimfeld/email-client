import { afterEach, describe, expect, it } from 'bun:test';
import { effectiveImportance } from '../categories';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDatabase,
  deleteCategory,
  listCategories,
  listEmails,
  saveCategory,
  saveClassification,
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

const classification = {
  category: 'action',
  importance: 'other' as const,
  model: 'test',
  categoryConfidence: 0.9,
  importanceConfidence: 0.9,
  categoryProbabilities: { action: 0.9 },
  importanceProbabilities: { other: 0.9 },
  hasActionItem: true,
  actionItemProbability: 0.9,
  hasReminder: false,
  reminderProbability: 0.2,
};

describe('category settings', () => {
  it('migrates saved importance flags to levels without losing category settings', () => {
    directory = mkdtempSync(join(tmpdir(), 'email-check-category-migration-'));
    const path = join(directory, 'test.sqlite');
    database = new DatabaseSync(path);
    database.exec(`CREATE TABLE categories (
			id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
			description TEXT NOT NULL, important INTEGER NOT NULL CHECK (important IN (0, 1))
		);
		INSERT INTO categories VALUES ('action', 'Follow up', 'Reply soon.', 1), ('custom', 'Travel', 'Bookings.', 0);`);
    database.close();
    database = createDatabase(path);
    expect(listCategories(database)).toEqual([
      { id: 'action', name: 'Follow up', description: 'Reply soon.', level: 'important' },
      { id: 'custom', name: 'Travel', description: 'Bookings.', level: 'auto' },
    ]);
    saveCategory(database, {
      id: 'custom',
      name: 'Travel',
      description: 'Bookings.',
      level: 'useful',
    });
    expect(listCategories(database)[1].level).toBe('useful');
  });

  it('migrates stored useful and not-useful messages to the new importance values', () => {
    directory = mkdtempSync(join(tmpdir(), 'email-check-importance-migration-'));
    const path = join(directory, 'test.sqlite');
    database = createDatabase(path);
    upsertEmails(database, 'test@example.com', [
      { id: 'useful' },
      { id: 'other' },
      { id: 'pending' },
    ]);
    database.exec(`ALTER TABLE emails DROP COLUMN importance;
			ALTER TABLE emails DROP COLUMN importance_confidence;
			ALTER TABLE emails DROP COLUMN importance_probabilities_json;
			UPDATE emails SET useful = 1, category = 'newsletter' WHERE gmail_id = 'useful';
			UPDATE emails SET useful = 0, category = 'newsletter' WHERE gmail_id = 'other';`);
    database.close();
    database = createDatabase(path);
    expect(
      Object.fromEntries(listEmails(database).map((email) => [email.gmailId, email.importance]))
    ).toEqual({ useful: 'useful', other: 'other', pending: null });
  });

  it('seeds the existing category IDs with Action needed important and preserves edits on restart', () => {
    directory = mkdtempSync(join(tmpdir(), 'email-check-categories-'));
    const path = join(directory, 'test.sqlite');
    database = createDatabase(path);
    const categories = listCategories(database);
    expect(categories.map((category) => category.id)).toEqual([
      'action',
      'personal',
      'work',
      'transaction',
      'newsletter',
      'notification',
      'marketing',
      'other',
    ]);
    expect(
      categories.filter((category) => category.level === 'important').map((category) => category.id)
    ).toEqual(['action']);
    saveCategory(database, {
      ...categories[0],
      name: 'Follow up',
      description: 'Messages that need a reply.',
      level: 'other',
    });
    deleteCategory(database, 'marketing');
    database.close();
    database = createDatabase(path);
    expect(listCategories(database)[0]).toEqual({
      id: 'action',
      name: 'Follow up',
      description: 'Messages that need a reply.',
      level: 'other',
    });
    expect(listCategories(database).some((category) => category.id === 'marketing')).toBe(false);
  });

  it('keeps message membership when a category is renamed or marked important', () => {
    database = createDatabase(':memory:');
    upsertEmails(database, 'test@example.com', [{ id: 'message', subject: 'Reply' }]);
    saveClassification(database, 'test@example.com', 'message', classification);
    saveCategory(database, {
      id: 'action',
      name: 'Reply',
      description: 'Reply to this message.',
      level: 'important',
    });
    const [email] = listEmails(database);
    expect(email.category).toBe('action');
    expect(email.importance).toBe('other');
    expect(listCategories(database).find((category) => category.id === email.category)?.level).toBe(
      'important'
    );
  });

  it('adds custom categories and rejects blank or duplicate names without changing saved settings', () => {
    database = createDatabase(':memory:');
    const id = saveCategory(database!, {
      name: ' Travel ',
      description: ' Travel plans. ',
      level: 'important',
    });
    expect(listCategories(database).find((category) => category.id === id)).toEqual({
      id,
      name: 'Travel',
      description: 'Travel plans.',
      level: 'important',
    });
    expect(() =>
      saveCategory(database!, { name: 'travel', description: 'Duplicate', level: 'other' })
    ).toThrow('already exists');
    expect(() =>
      saveCategory(database!, { id, name: ' ', description: 'Test', level: 'other' })
    ).toThrow('name and a description');
    expect(() =>
      saveCategory(database!, { id, name: 'Travel', description: ' ', level: 'other' })
    ).toThrow('name and a description');
    expect(listCategories(database).find((category) => category.id === id)?.level).toBe(
      'important'
    );
  });

  it('moves messages from a removed category to pending and rejects results for a removed category', () => {
    database = createDatabase(':memory:');
    const message = { id: 'message', subject: 'Reply' };
    upsertEmails(database, 'test@example.com', [message]);
    saveClassification(database!, 'test@example.com', message.id, classification);
    deleteCategory(database, 'action');
    expect(listEmails(database)[0].category).toBeNull();
    expect(listEmails(database)[0].categoryConfidence).toBeNull();
    expect(upsertEmails(database, 'test@example.com', [message])).toEqual([message]);
    expect(() =>
      saveClassification(database!, 'test@example.com', message.id, classification)
    ).toThrow('no longer exists');
  });
});

describe('effective message importance', () => {
  it('uses fixed category levels and uses Jev results for Auto', () => {
    for (const level of ['important', 'useful', 'other'] as const) {
      expect(effectiveImportance(level, null)).toBe(level);
      expect(effectiveImportance(level, 'other')).toBe(level);
      expect(effectiveImportance('auto', level)).toBe(level);
    }
    expect(effectiveImportance('auto', null)).toBeNull();
    expect(effectiveImportance(undefined, 'important')).toBeNull();
  });

  it('orders messages by date without sorting by effective importance', () => {
    database = createDatabase(':memory:');
    upsertEmails(database, 'test@example.com', [
      { id: 'older-important', date: '2026-01-01T00:00:00.000Z' },
      { id: 'newer-other', date: '2026-01-02T00:00:00.000Z' },
    ]);
    saveClassification(database, 'test@example.com', 'older-important', {
      ...classification,
      importance: null,
    });
    saveClassification(database, 'test@example.com', 'newer-other', {
      ...classification,
      category: 'newsletter',
      importance: 'other',
    });

    expect(listEmails(database).map((email) => email.gmailId)).toEqual([
      'newer-other',
      'older-important',
    ]);
  });
});
