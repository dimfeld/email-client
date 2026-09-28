import { expect, test } from 'bun:test';
import type { ChatAction } from '$lib/email-chat';
import { createDatabase } from './db';
import { getNote } from './notes';
import { listPimCategories } from './pim-categories';
import { createPimChatTools } from './pim-chat-tools';
import { getTodo } from './todos';

const context = { toolCallId: 'test', messages: [], context: {} };

test('chat tools create, find, and change notes and to-dos', async () => {
  const database = createDatabase(':memory:');
  const actions: ChatAction[] = [];
  const tools = createPimChatTools(database, actions);
  const note = (await tools.createNote.execute!(
    { title: 'Trip', body: '- passport', category: 'Travel' },
    context
  )) as { id: number };
  const todo = (await tools.createTodo.execute!(
    {
      title: 'Book hotel',
      description: '',
      category: 'travel',
      dueDate: '2026-10-02',
      dueTime: '09:00',
      sourceEmailId: null,
    },
    context
  )) as { id: number };
  expect(listPimCategories(database).map((category) => category.name)).toEqual(['Travel']);
  expect(await tools.readTodo.execute!({ id: todo.id }, context)).toMatchObject({
    title: 'Book hotel',
    dueDate: '2026-10-02',
    category: 'Travel',
  });
  await expect(tools.readTodo.execute!({ id: todo.id + 1 }, context)).rejects.toThrow(
    'does not exist'
  );

  const found = await tools.searchNotesAndTodos.execute!(
    { query: 'pass', offset: 0, limit: 10 },
    context
  );
  expect(found).toMatchObject({ notes: [{ id: note.id, category: 'Travel' }], todos: [] });

  await tools.updateNote.execute!(
    { id: note.id, title: null, body: '- passport\n- charger', category: '' },
    context
  );
  expect(getNote(database, note.id)).toMatchObject({ title: 'Trip', categoryId: null });

  await tools.updateTodo.execute!(
    {
      id: todo.id,
      title: null,
      description: null,
      category: null,
      dueDate: '',
      dueTime: null,
      completed: true,
    },
    context
  );
  expect(getTodo(database, todo.id)).toMatchObject({ dueDate: null, dueTime: null });
  expect(getTodo(database, todo.id)?.completedAt).not.toBeNull();
  expect(actions.map((action) => action.href)).toEqual([
    `/notes?note=${note.id}`,
    `/todos?todo=${todo.id}`,
    `/notes?note=${note.id}`,
    `/todos?todo=${todo.id}`,
  ]);
  database.close();
});
