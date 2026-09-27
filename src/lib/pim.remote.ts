import { command, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { getDatabase } from '$lib/server/db';
import {
  createNote,
  deleteNote,
  listNotes,
  NoteConflictError,
  updateNote,
} from '$lib/server/notes';
import {
  createPimCategory,
  deletePimCategory,
  listPimCategories,
  PimValidationError,
  renamePimCategory,
} from '$lib/server/pim-categories';
import {
  createTodo,
  deleteTodo,
  listTodos,
  listTodoTitlesForEmail,
  reorderTodos,
  updateTodo,
} from '$lib/server/todos';

const id = z.number().int().positive();
const categoryId = id.nullable();
const dueDate = z.string().nullable();
const dueTime = z.string().nullable();

// Input errors go to the browser with the message for the user. A stale note edit is a 409.
function run<T>(operation: () => T): T {
  try {
    return operation();
  } catch (cause) {
    if (cause instanceof NoteConflictError) error(409, cause.message);
    if (cause instanceof PimValidationError) error(400, cause.message);
    throw cause;
  }
}

export const getPimCategories = query(() => listPimCategories(getDatabase()));

export const getNotes = query(z.string(), (search) => listNotes(getDatabase(), search));

export const getTodos = query(z.string(), (search) => listTodos(getDatabase(), search));

/** Notes and to-dos for a mail search. Mail filters such as `from:` match none. */
export const searchPim = query(z.string(), (search) => {
  const database = getDatabase();
  return { notes: listNotes(database, search), todos: listTodos(database, search) };
});

/** The titles of to-dos made from an email, so its extracted items show as added. */
export const getEmailTodoTitles = query(id, (emailId) =>
  listTodoTitlesForEmail(getDatabase(), emailId)
);

export const createPimCategoryCommand = command(z.string(), (name) =>
  run(() => createPimCategory(getDatabase(), name))
);

export const renamePimCategoryCommand = command(z.object({ id, name: z.string() }), (input) =>
  run(() => renamePimCategory(getDatabase(), input.id, input.name))
);

export const deletePimCategoryCommand = command(id, (value) =>
  deletePimCategory(getDatabase(), value)
);

export const createNoteCommand = command(
  z.object({ title: z.string(), body: z.string(), categoryId }),
  (input) => run(() => createNote(getDatabase(), input))
);

export const updateNoteCommand = command(
  z.object({
    id,
    revision: z.number().int(),
    title: z.string().optional(),
    body: z.string().optional(),
    categoryId: categoryId.optional(),
  }),
  ({ id, revision, ...change }) => run(() => updateNote(getDatabase(), id, change, revision))
);

export const deleteNoteCommand = command(id, (value) => deleteNote(getDatabase(), value));

export const createTodoCommand = command(
  z.object({
    title: z.string(),
    description: z.string().optional(),
    categoryId: categoryId.optional(),
    dueDate: dueDate.optional(),
    dueTime: dueTime.optional(),
    sourceEmailId: id.nullable().optional(),
  }),
  (input) => run(() => createTodo(getDatabase(), input))
);

export const updateTodoCommand = command(
  z.object({
    id,
    title: z.string().optional(),
    description: z.string().optional(),
    categoryId: categoryId.optional(),
    dueDate: dueDate.optional(),
    dueTime: dueTime.optional(),
    completed: z.boolean().optional(),
  }),
  ({ id, ...change }) => run(() => updateTodo(getDatabase(), id, change))
);

export const deleteTodoCommand = command(id, (value) => deleteTodo(getDatabase(), value));

export const reorderTodosCommand = command(z.object({ categoryId, ids: z.array(id) }), (input) =>
  run(() => reorderTodos(getDatabase(), input.categoryId, input.ids))
);
