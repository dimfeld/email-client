import { dateKeyFromDate } from './calendar';

/** A user category for notes and to-dos. */
export type PimCategory = { id: number; name: string };

export type Note = {
  id: number;
  title: string;
  /** Markdown. */
  body: string;
  categoryId: number | null;
  /** Goes up by one with each change, so a stale editor cannot overwrite a newer change. */
  revision: number;
  createdAt: string;
  updatedAt: string;
};

/** A to-do. A to-do with a due date is a reminder. */
export type Todo = {
  id: number;
  title: string;
  /** Markdown. */
  description: string;
  categoryId: number | null;
  /** The order in the category. */
  position: number;
  /** YYYY-MM-DD in local time. */
  dueDate: string | null;
  /** HH:MM in local time. Only set when `dueDate` is set. */
  dueTime: string | null;
  completedAt: string | null;
  sourceEmailId: number | null;
  createdAt: string;
  updatedAt: string;
};

/** Markdown as plain text for one-line previews and search results. */
export function markdownPreview(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, '')
    .replace(/[*_~`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The note title, or its first text when it has no title. */
export function noteLabel(note: Pick<Note, 'title' | 'body'>): string {
  return note.title.trim() || markdownPreview(note.body) || 'Untitled note';
}

/** Returns `ids` with `id` moved to `index`. */
export function moveId(ids: number[], id: number, index: number): number[] {
  const rest = ids.filter((item) => item !== id);
  if (rest.length === ids.length) return ids;
  const target = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, target), id, ...rest.slice(target)];
}

/** The index for a dragged row: the number of other rows whose middle is above `y`. */
export function dropIndex(middles: number[], y: number): number {
  return middles.filter((middle) => middle < y).length;
}

/** Converts an extracted due time (a date or an ISO time) to a local date and time. */
export function localDue(value: string | null): { dueDate: string | null; dueTime: string | null } {
  if (!value) return { dueDate: null, dueTime: null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { dueDate: value, dueTime: null };
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return { dueDate: null, dueTime: null };
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return { dueDate: dateKeyFromDate(date), dueTime: time };
}

/** True when an open to-do is past its due date, or past its due time today. */
export function isOverdue(
  todo: Pick<Todo, 'dueDate' | 'dueTime' | 'completedAt'>,
  now = new Date()
) {
  if (!todo.dueDate || todo.completedAt) return false;
  const today = dateKeyFromDate(now);
  if (todo.dueDate !== today) return todo.dueDate < today;
  if (!todo.dueTime) return false;
  const current = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return todo.dueTime < current;
}

export function dueLabel(todo: Pick<Todo, 'dueDate' | 'dueTime'>, now = new Date()): string | null {
  if (!todo.dueDate) return null;
  const [year, month, day] = todo.dueDate.split('-').map(Number);
  const [hours, minutes] = (todo.dueTime ?? '00:00').split(':').map(Number);
  const date = new Date(year, month - 1, day, hours, minutes);
  const today = dateKeyFromDate(now);
  const tomorrow = dateKeyFromDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const dayText =
    todo.dueDate === today
      ? 'Today'
      : todo.dueDate === tomorrow
        ? 'Tomorrow'
        : new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
          }).format(date);
  return todo.dueTime
    ? `${dayText}, ${new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(date)}`
    : dayText;
}

/** Open to-dos with a due date, soonest first. To-dos without a time come first on a day. */
export function compareDue(a: Todo, b: Todo): number {
  return (
    (a.dueDate ?? '').localeCompare(b.dueDate ?? '') ||
    (a.dueTime ?? '').localeCompare(b.dueTime ?? '') ||
    a.position - b.position
  );
}

/** The message for a failed remote command. Input errors carry a message for the user. */
export function commandError(error: unknown): string {
  const body = (error as { body?: { message?: unknown } } | null)?.body;
  if (typeof body?.message === 'string') return body.message;
  return error instanceof Error ? error.message : 'The change was not saved.';
}
