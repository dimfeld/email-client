import { expect, test } from 'bun:test';
import {
  dropIndex,
  dueLabel,
  isOverdue,
  localDue,
  markdownPreview,
  moveId,
  noteLabel,
} from './pim';

test('moves an ID to a new index', () => {
  expect(moveId([1, 2, 3], 3, 0)).toEqual([3, 1, 2]);
  expect(moveId([1, 2, 3], 1, 5)).toEqual([2, 3, 1]);
  expect(moveId([1, 2, 3], 9, 0)).toEqual([1, 2, 3]);
  expect(dropIndex([10, 30, 50], 35)).toBe(2);
});

test('makes plain previews from Markdown', () => {
  expect(markdownPreview('# Title\n- [ ] **bold** [link](https://x.test)')).toBe('Title bold link');
  expect(noteLabel({ title: '', body: '' })).toBe('Untitled note');
  expect(noteLabel({ title: '  ', body: '## Plan' })).toBe('Plan');
});

test('converts extracted due values to local dates', () => {
  expect(localDue('2026-10-01')).toEqual({ dueDate: '2026-10-01', dueTime: null });
  const date = new Date(2026, 9, 1, 14, 5);
  expect(localDue(date.toISOString())).toEqual({ dueDate: '2026-10-01', dueTime: '14:05' });
  expect(localDue('soon')).toEqual({ dueDate: null, dueTime: null });
});

test('finds overdue to-dos and labels due dates', () => {
  const now = new Date(2026, 8, 27, 12, 0);
  const todo = { dueDate: '2026-09-27', dueTime: '11:00', completedAt: null };
  expect(isOverdue(todo, now)).toBe(true);
  expect(isOverdue({ ...todo, dueTime: null }, now)).toBe(false);
  expect(isOverdue({ ...todo, dueDate: '2026-09-26', dueTime: null }, now)).toBe(true);
  expect(isOverdue({ ...todo, completedAt: 'x' }, now)).toBe(false);
  expect(dueLabel({ dueDate: '2026-09-28', dueTime: null }, now)).toBe('Tomorrow');
  expect(dueLabel({ dueDate: null, dueTime: null }, now)).toBeNull();
});
