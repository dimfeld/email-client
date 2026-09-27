import { tool } from 'ai';
import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import type { ChatAction } from '$lib/email-chat';
import type { Note, Todo } from '$lib/pim';
import { createNote, getNote, listNotes, updateNote } from './notes';
import { ensurePimCategory, listPimCategories } from './pim-categories';
import { createTodo, getTodo, listTodos, updateTodo, type TodoChange } from './todos';

// Tool inputs have no optional fields. In updates, null keeps the current value.
const categoryInput = z
  .string()
  .nullable()
  .describe('Category name. An unknown name creates the category. "" means uncategorized.');

/** Chat tools that read and change notes and to-dos. Completed changes go into `actions`. */
export function createPimChatTools(
  database: DatabaseSync,
  actions: ChatAction[],
  signal?: AbortSignal
) {
  const categoryName = (id: number | null) =>
    id === null ? null : (listPimCategories(database).find((item) => item.id === id)?.name ?? null);
  const categoryId = (name: string) => (name.trim() ? ensurePimCategory(database, name).id : null);
  const noteResult = (note: Note) => ({
    id: note.id,
    title: note.title,
    category: categoryName(note.categoryId),
    updatedAt: note.updatedAt,
  });
  const todoResult = (todo: Todo) => ({
    id: todo.id,
    title: todo.title,
    description: todo.description,
    category: categoryName(todo.categoryId),
    dueDate: todo.dueDate,
    dueTime: todo.dueTime,
    completed: todo.completedAt !== null,
    sourceEmailId: todo.sourceEmailId,
  });
  const record = (kind: 'note' | 'todo', id: number, label: string) =>
    actions.push({
      kind,
      id,
      label,
      href: kind === 'note' ? `/notes?note=${id}` : `/todos?todo=${id}`,
    });

  return {
    searchNotesAndTodos: tool({
      description:
        'Search the user notes and to-dos. A to-do with a due date is a reminder. Words match as prefixes; quoted text matches as a phrase. An empty query lists everything: notes by last change, to-dos in list order. Use offset for more results. Use readNote for the text of a note.',
      inputSchema: z.object({
        query: z.string(),
        offset: z.number().int().nonnegative(),
        limit: z.number().int().positive(),
      }),
      execute: async ({ query, offset, limit }) => {
        signal?.throwIfAborted();
        const notes = listNotes(database, query);
        const todos = listTodos(database, query);
        const page = <T>(items: T[]) => items.slice(offset, offset + limit);
        return {
          categories: listPimCategories(database).map((category) => category.name),
          notes: page(notes).map(noteResult),
          todos: page(todos).map(todoResult),
          nextOffset: Math.max(notes.length, todos.length) > offset + limit ? offset + limit : null,
        };
      },
    }),
    readNote: tool({
      description: 'Read the full Markdown text of a note.',
      inputSchema: z.object({ id: z.number().int().positive() }),
      execute: async ({ id }) => {
        signal?.throwIfAborted();
        const note = getNote(database, id);
        if (!note) throw new Error('This note does not exist.');
        return { ...noteResult(note), body: note.body };
      },
    }),
    createNote: tool({
      description:
        'Create a note. The body is Markdown. Only call when the user asks for a note. The change takes effect immediately.',
      inputSchema: z.object({ title: z.string(), body: z.string(), category: categoryInput }),
      execute: async ({ title, body, category }) => {
        signal?.throwIfAborted();
        const note = createNote(database, {
          title,
          body,
          categoryId: category ? categoryId(category) : null,
        });
        record('note', note.id, `Created note “${note.title || 'Untitled'}”`);
        return noteResult(note);
      },
    }),
    updateNote: tool({
      description:
        'Change a note. Null keeps a field. The body replaces the complete text, so read the note first and keep the parts the user did not ask to change. Only call when the user asks for the change. The change takes effect immediately.',
      inputSchema: z.object({
        id: z.number().int().positive(),
        title: z.string().nullable(),
        body: z.string().nullable(),
        category: categoryInput,
      }),
      execute: async ({ id, title, body, category }) => {
        signal?.throwIfAborted();
        const note = updateNote(database, id, {
          title: title ?? undefined,
          body: body ?? undefined,
          categoryId: category === null ? undefined : categoryId(category),
        });
        record('note', note.id, `Changed note “${note.title || 'Untitled'}”`);
        return noteResult(note);
      },
    }),
    createTodo: tool({
      description:
        'Create a to-do. Give a due date to make a reminder. The description is Markdown. Only call when the user asks for a to-do or reminder. The change takes effect immediately.',
      inputSchema: z.object({
        title: z.string(),
        description: z.string(),
        category: categoryInput,
        dueDate: z.string().nullable().describe('YYYY-MM-DD in the user local time, or null.'),
        dueTime: z.string().nullable().describe('HH:MM in the user local time, or null.'),
        sourceEmailId: z
          .number()
          .int()
          .positive()
          .nullable()
          .describe('The message ID when the to-do comes from an email.'),
      }),
      execute: async ({ title, description, category, dueDate, dueTime, sourceEmailId }) => {
        signal?.throwIfAborted();
        const todo = createTodo(database, {
          title,
          description,
          categoryId: category ? categoryId(category) : null,
          dueDate,
          dueTime,
          sourceEmailId,
        });
        record('todo', todo.id, `Created ${todo.dueDate ? 'reminder' : 'to-do'} “${todo.title}”`);
        return todoResult(todo);
      },
    }),
    updateTodo: tool({
      description:
        'Change a to-do or reminder, or mark it complete. Null keeps a field. "" for dueDate removes the due date and time; "" for dueTime removes the time. Only call when the user asks for the change. The change takes effect immediately.',
      inputSchema: z.object({
        id: z.number().int().positive(),
        title: z.string().nullable(),
        description: z.string().nullable(),
        category: categoryInput,
        dueDate: z.string().nullable(),
        dueTime: z.string().nullable(),
        completed: z.boolean().nullable(),
      }),
      execute: async ({ id, title, description, category, dueDate, dueTime, completed }) => {
        signal?.throwIfAborted();
        if (!getTodo(database, id)) throw new Error('This to-do does not exist.');
        const change: TodoChange = {};
        if (title !== null) change.title = title;
        if (description !== null) change.description = description;
        if (category !== null) change.categoryId = categoryId(category);
        if (dueDate !== null) change.dueDate = dueDate || null;
        if (dueTime !== null) change.dueTime = dueTime || null;
        if (completed !== null) change.completed = completed;
        const todo = updateTodo(database, id, change);
        record(
          'todo',
          todo.id,
          completed === true ? `Completed “${todo.title}”` : `Changed to-do “${todo.title}”`
        );
        return todoResult(todo);
      },
    }),
  };
}
