import type { DatabaseSync } from 'node:sqlite';
import { isDateKey } from '$lib/calendar';
import { reminderTime, type Todo } from '$lib/pim';
import { PimValidationError, requireCategory } from './pim-categories';
import { pimMatchQuery } from './pim-schema';
import { publishStateChange } from './state-events';

export type TodoInput = {
  title: string;
  description?: string;
  categoryId?: number | null;
  dueDate?: string | null;
  dueTime?: string | null;
  sourceEmailId?: number | null;
};

export type TodoChange = Partial<Omit<TodoInput, 'sourceEmailId'>> & { completed?: boolean };

type TodoRow = {
  id: number;
  title: string;
  description: string;
  category_id: number | null;
  position: number;
  due_date: string | null;
  due_time: string | null;
  completed_at: string | null;
  source_email_id: number | null;
  created_at: string;
  updated_at: string;
};

const nullableNumber = (value: number | null) => (value === null ? null : Number(value));

function todoFromRow(row: TodoRow): Todo {
  return {
    id: Number(row.id),
    title: row.title,
    description: row.description,
    categoryId: nullableNumber(row.category_id),
    position: Number(row.position),
    dueDate: row.due_date,
    dueTime: row.due_time,
    completedAt: row.completed_at,
    sourceEmailId: nullableNumber(row.source_email_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validTitle(title: string): string {
  const value = title.trim();
  if (!value) throw new PimValidationError('Enter a title for the to-do.');
  return value;
}

function validDue(dueDate: string | null, dueTime: string | null) {
  const date = dueDate || null;
  const time = dueTime || null;
  if (date !== null && !isDateKey(date))
    throw new PimValidationError('Use YYYY-MM-DD for the date.');
  if (time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new PimValidationError('Use HH:MM for the time.');
  if (time !== null && date === null) throw new PimValidationError('Add a date for the time.');
  return { date, time };
}

/**
 * The `reminder_sent_at` value for a new due time. A time that already passed counts as sent,
 * so a new overdue to-do does not send a notification.
 */
function reminderState(dueDate: string | null, dueTime: string | null, now: Date): string | null {
  const time = reminderTime({ dueDate, dueTime });
  return time && time <= now ? now.toISOString() : null;
}

function nextPosition(database: DatabaseSync, categoryId: number | null): number {
  const row = database
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM todos WHERE category_id IS ?')
    .get(categoryId) as { next: number };
  return Number(row.next);
}

/** All to-dos in category order. A search returns only matches, best match first. */
export function listTodos(database: DatabaseSync, search = ''): Todo[] {
  if (search.trim()) {
    const match = pimMatchQuery(search);
    if (!match) return [];
    return (
      database
        .prepare(
          `SELECT t.* FROM todo_fts JOIN todos t ON t.id = todo_fts.rowid
           WHERE todo_fts MATCH ? ORDER BY t.completed_at IS NOT NULL, bm25(todo_fts)`
        )
        .all(match) as TodoRow[]
    ).map(todoFromRow);
  }
  return (database.prepare('SELECT * FROM todos ORDER BY position, id').all() as TodoRow[]).map(
    todoFromRow
  );
}

export function listTodoTitlesForEmail(database: DatabaseSync, emailId: number): string[] {
  return database
    .prepare('SELECT title FROM todos WHERE source_email_id = ?')
    .all(emailId)
    .map((row) => String(row.title));
}

export function getTodo(database: DatabaseSync, id: number): Todo | null {
  const row = database.prepare('SELECT * FROM todos WHERE id = ?').get(id) as TodoRow | undefined;
  return row ? todoFromRow(row) : null;
}

/** Adds a to-do at the end of its category. */
export function createTodo(database: DatabaseSync, input: TodoInput): Todo {
  const title = validTitle(input.title);
  const due = validDue(input.dueDate ?? null, input.dueTime ?? null);
  const categoryId = requireCategory(database, input.categoryId ?? null);
  const date = new Date();
  const now = date.toISOString();
  const result = database
    .prepare(
      `INSERT INTO todos (title, description, category_id, position, due_date, due_time,
       reminder_sent_at, source_email_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      title,
      input.description ?? '',
      categoryId,
      nextPosition(database, categoryId),
      due.date,
      due.time,
      reminderState(due.date, due.time, date),
      input.sourceEmailId ?? null,
      now,
      now
    );
  publishStateChange('pim');
  return getTodo(database, Number(result.lastInsertRowid))!;
}

/** Changes the fields that are set. A to-do that moves to another category goes to its end. */
export function updateTodo(database: DatabaseSync, id: number, change: TodoChange): Todo {
  const todo = getTodo(database, id);
  if (!todo) throw new PimValidationError('This to-do no longer exists.');
  const title = change.title === undefined ? todo.title : validTitle(change.title);
  const due = validDue(
    change.dueDate === undefined ? todo.dueDate : change.dueDate,
    change.dueTime === undefined ? (change.dueDate === null ? null : todo.dueTime) : change.dueTime
  );
  const categoryId =
    change.categoryId === undefined
      ? todo.categoryId
      : requireCategory(database, change.categoryId);
  const position =
    categoryId === todo.categoryId ? todo.position : nextPosition(database, categoryId);
  const date = new Date();
  const now = date.toISOString();
  const completedAt =
    change.completed === undefined
      ? todo.completedAt
      : change.completed
        ? (todo.completedAt ?? now)
        : null;
  // A new due time, or a to-do opened again, needs a new notification.
  const reopened = todo.completedAt !== null && completedAt === null;
  const dueChanged = due.date !== todo.dueDate || due.time !== todo.dueTime;
  const reminderSentAt =
    dueChanged || reopened
      ? reminderState(due.date, due.time, date)
      : (
          database.prepare('SELECT reminder_sent_at FROM todos WHERE id = ?').get(id) as {
            reminder_sent_at: string | null;
          }
        ).reminder_sent_at;
  database
    .prepare(
      `UPDATE todos SET title = ?, description = ?, category_id = ?, position = ?, due_date = ?,
       due_time = ?, completed_at = ?, reminder_sent_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(
      title,
      change.description ?? todo.description,
      categoryId,
      position,
      due.date,
      due.time,
      completedAt,
      reminderSentAt,
      now,
      id
    );
  publishStateChange('pim');
  return getTodo(database, id)!;
}

export function deleteTodo(database: DatabaseSync, id: number): boolean {
  const deleted = database.prepare('DELETE FROM todos WHERE id = ?').run(id).changes > 0;
  if (deleted) publishStateChange('pim');
  return deleted;
}

/**
 * Puts the listed to-dos of one category in the given order. To-dos of the category that are
 * not listed, such as completed ones, keep their place after the listed ones.
 */
export function reorderTodos(database: DatabaseSync, categoryId: number | null, ids: number[]) {
  const current = database
    .prepare('SELECT id FROM todos WHERE category_id IS ? ORDER BY position, id')
    .all(categoryId)
    .map((row) => Number(row.id));
  const members = new Set(current);
  if (new Set(ids).size !== ids.length || ids.some((id) => !members.has(id)))
    throw new PimValidationError('The list changed. Try the move again.');
  const listed = new Set(ids);
  const order = [...ids, ...current.filter((id) => !listed.has(id))];
  const update = database.prepare('UPDATE todos SET position = ? WHERE id = ?');
  database.exec('BEGIN IMMEDIATE');
  try {
    order.forEach((id, index) => update.run(index, id));
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  publishStateChange('pim');
}

/** Open to-dos whose reminder time has come and whose notification has not gone out. */
export function listDueReminders(database: DatabaseSync, now = new Date()): Todo[] {
  return listPendingReminders(database).filter((todo) => reminderTime(todo)! <= now);
}

/** Open to-dos with a due date whose notification has not gone out. */
export function listPendingReminders(database: DatabaseSync): Todo[] {
  return (
    database
      .prepare(
        `SELECT * FROM todos WHERE due_date IS NOT NULL AND completed_at IS NULL
         AND reminder_sent_at IS NULL`
      )
      .all() as TodoRow[]
  ).map(todoFromRow);
}

export function markReminderSent(database: DatabaseSync, id: number, now = new Date()): void {
  database.prepare('UPDATE todos SET reminder_sent_at = ? WHERE id = ?').run(now.toISOString(), id);
}
