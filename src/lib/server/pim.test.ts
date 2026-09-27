import { afterEach, expect, test } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { createDatabase } from './db';
import { createNote, deleteNote, listNotes, NoteConflictError, updateNote } from './notes';
import {
  createPimCategory,
  deletePimCategory,
  ensurePimCategory,
  listPimCategories,
  PimValidationError,
  renamePimCategory,
} from './pim-categories';
import { pimMatchQuery } from './pim-schema';
import { createTodo, listTodos, reorderTodos, updateTodo } from './todos';

let database: DatabaseSync | undefined;
afterEach(() => {
  database?.close();
  database = undefined;
});
const setup = () => (database = createDatabase(':memory:'));

test('builds prefix queries and skips mail filters', () => {
  expect(pimMatchQuery('gro list')).toBe('"gro"* AND "list"*');
  expect(pimMatchQuery('"exact words" x')).toBe('"exact words" AND "x"*');
  expect(pimMatchQuery('from:bob milk')).toBeNull();
  expect(pimMatchQuery('  - ')).toBeNull();
});

test('saves Markdown notes, finds them by prefix, and rejects stale revisions', () => {
  const db = setup();
  const work = createPimCategory(db, 'Work');
  const note = createNote(db, { title: 'Groceries', body: '- milk\n- **bread**' });
  expect(note.categoryId).toBeNull();
  expect(listNotes(db, 'brea').map((item) => item.id)).toEqual([note.id]);

  const changed = updateNote(db, note.id, { categoryId: work.id }, note.revision);
  expect(changed.revision).toBe(note.revision + 1);
  expect(changed.body).toBe(note.body);
  expect(() => updateNote(db, note.id, { body: 'old editor' }, note.revision)).toThrow(
    NoteConflictError
  );

  deletePimCategory(db, work.id);
  expect(listNotes(db)[0].categoryId).toBeNull();
  expect(deleteNote(db, note.id)).toBe(true);
  expect(listNotes(db, 'milk')).toEqual([]);
});

test('keeps category names unique without regard to case', () => {
  const db = setup();
  const home = createPimCategory(db, 'Home');
  expect(() => createPimCategory(db, 'home')).toThrow(PimValidationError);
  expect(ensurePimCategory(db, 'HOME').id).toBe(home.id);
  renamePimCategory(db, home.id, 'House');
  expect(listPimCategories(db)).toEqual([{ id: home.id, name: 'House' }]);
});

test('orders to-dos in a category and appends moved to-dos', () => {
  const db = setup();
  const work = createPimCategory(db, 'Work');
  const [a, b, c] = ['A', 'B', 'C'].map((title) => createTodo(db, { title }));
  const other = createTodo(db, { title: 'Other', categoryId: work.id });
  const order = () =>
    listTodos(db)
      .filter((todo) => todo.categoryId === null)
      .map((todo) => todo.title);

  reorderTodos(db, null, [c.id, a.id]);
  expect(order()).toEqual(['C', 'A', 'B']);
  expect(() => reorderTodos(db, null, [other.id])).toThrow(PimValidationError);

  updateTodo(db, other.id, { categoryId: null });
  expect(order()).toEqual(['C', 'A', 'B', 'Other']);

  // Deleting a category moves its to-dos after the uncategorized ones.
  updateTodo(db, b.id, { categoryId: work.id });
  deletePimCategory(db, work.id);
  expect(order()).toEqual(['C', 'A', 'Other', 'B']);
});

test('validates due dates and marks to-dos complete', () => {
  const db = setup();
  expect(() => createTodo(db, { title: ' ' })).toThrow(PimValidationError);
  expect(() => createTodo(db, { title: 'x', dueTime: '09:00' })).toThrow('Add a date');
  expect(() => createTodo(db, { title: 'x', dueDate: '2026-02-30' })).toThrow('YYYY-MM-DD');
  const todo = createTodo(db, {
    title: 'Pay rent',
    description: 'Use the *bank* app',
    dueDate: '2026-10-01',
    dueTime: '09:30',
  });
  const done = updateTodo(db, todo.id, { completed: true });
  expect(done.completedAt).not.toBeNull();
  expect(updateTodo(db, todo.id, { dueDate: null })).toMatchObject({
    dueDate: null,
    dueTime: null,
    completedAt: done.completedAt,
  });
  expect(listTodos(db, 'bank').map((item) => item.id)).toEqual([todo.id]);
});
