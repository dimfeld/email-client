import { afterEach, expect, test } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { createDatabase, savePushSubscription } from './db';
import { migratePimSchema } from './pim-schema';
import { sendDueReminders } from './reminders';
import { createTodo, updateTodo } from './todos';

let database: DatabaseSync | undefined;
afterEach(() => {
  database?.close();
  database = undefined;
});

function setup() {
  database = createDatabase(':memory:');
  savePushSubscription(database, {
    endpoint: 'https://push.example/live',
    keys: { p256dh: 'key', auth: 'auth' },
  });
  const sent: { title: string; url: string; tag: string }[] = [];
  const send = async (_: unknown, payload: string) => void sent.push(JSON.parse(payload));
  return { db: database, sent, send };
}

test('sends each reminder one time at its due time', async () => {
  const { db, sent, send } = setup();
  const todo = createTodo(db, { title: 'Pay rent', dueDate: '2099-01-01', dueTime: '09:30' });
  createTodo(db, { title: 'No date' });
  expect(await sendDueReminders(db, new Date(2099, 0, 1, 9, 29), send)).toBe(0);
  expect(await sendDueReminders(db, new Date(2099, 0, 1, 9, 30), send)).toBe(1);
  expect(await sendDueReminders(db, new Date(2099, 0, 1, 10, 0), send)).toBe(0);
  expect(sent).toEqual([
    expect.objectContaining({
      title: 'Pay rent',
      url: `/todos?todo=${todo.id}`,
      tag: `todo:${todo.id}`,
    }),
  ]);

  // A new due time sends again.
  updateTodo(db, todo.id, { dueTime: '11:00' });
  expect(await sendDueReminders(db, new Date(2099, 0, 1, 11, 0), send)).toBe(1);
});

test('sends a date-only reminder at 06:00 local time', async () => {
  const { db, send } = setup();
  createTodo(db, { title: 'Call mom', dueDate: '2099-03-04' });
  expect(await sendDueReminders(db, new Date(2099, 2, 4, 5, 59), send)).toBe(0);
  expect(await sendDueReminders(db, new Date(2099, 2, 4, 6, 0), send)).toBe(1);
});

test('skips completed and already overdue reminders', async () => {
  const { db, send } = setup();
  createTodo(db, { title: 'Past', dueDate: '2000-01-01' });
  const done = createTodo(db, { title: 'Done', dueDate: '2099-01-01' });
  updateTodo(db, done.id, { completed: true });
  expect(await sendDueReminders(db, new Date(2099, 0, 2), send)).toBe(0);

  // Opening it again with a future time sends the reminder.
  updateTodo(db, done.id, { completed: false, dueDate: '2099-02-01' });
  expect(await sendDueReminders(db, new Date(2099, 1, 1, 6, 0), send)).toBe(1);
});

test('the migration marks reminders that were already due as sent', async () => {
  const { db, send } = setup();
  db.exec('ALTER TABLE todos DROP COLUMN reminder_sent_at');
  const insert = db.prepare(`INSERT INTO todos (title, position, due_date, created_at, updated_at)
    VALUES (?, 0, ?, '', '')`);
  insert.run('Old', '2000-01-01');
  insert.run('Future', '2099-01-01');
  migratePimSchema(db);
  expect(await sendDueReminders(db, new Date(2099, 0, 1, 6, 0), send)).toBe(1);
});
