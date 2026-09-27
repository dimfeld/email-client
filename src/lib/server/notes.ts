import type { DatabaseSync } from 'node:sqlite';
import type { Note } from '$lib/pim';
import { PimValidationError, requireCategory } from './pim-categories';
import { pimMatchQuery } from './pim-schema';
import { publishStateChange } from './state-events';

export class NoteConflictError extends PimValidationError {}

type NoteRow = {
  id: number;
  title: string;
  body: string;
  category_id: number | null;
  revision: number;
  created_at: string;
  updated_at: string;
};

function noteFromRow(row: NoteRow): Note {
  return {
    id: Number(row.id),
    title: row.title,
    body: row.body,
    categoryId: row.category_id === null ? null : Number(row.category_id),
    revision: Number(row.revision),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** All notes, most recently changed first. A search returns the best matches first. */
export function listNotes(database: DatabaseSync, search = ''): Note[] {
  if (search.trim()) {
    const match = pimMatchQuery(search);
    if (!match) return [];
    return (
      database
        .prepare(
          `SELECT n.* FROM note_fts JOIN notes n ON n.id = note_fts.rowid
           WHERE note_fts MATCH ? ORDER BY bm25(note_fts), n.updated_at DESC`
        )
        .all(match) as NoteRow[]
    ).map(noteFromRow);
  }
  return (
    database.prepare('SELECT * FROM notes ORDER BY updated_at DESC, id DESC').all() as NoteRow[]
  ).map(noteFromRow);
}

export function getNote(database: DatabaseSync, id: number): Note | null {
  const row = database.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow | undefined;
  return row ? noteFromRow(row) : null;
}

export function createNote(
  database: DatabaseSync,
  input: { title?: string; body?: string; categoryId?: number | null } = {}
): Note {
  const now = new Date().toISOString();
  const categoryId = requireCategory(database, input.categoryId ?? null);
  const result = database
    .prepare(
      'INSERT INTO notes (title, body, category_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(input.title?.trim() ?? '', input.body ?? '', categoryId, now, now);
  publishStateChange('pim');
  return getNote(database, Number(result.lastInsertRowid))!;
}

/**
 * Changes the fields that are set. With `revision`, the change fails when another writer
 * changed the note after that revision.
 */
export function updateNote(
  database: DatabaseSync,
  id: number,
  change: { title?: string; body?: string; categoryId?: number | null },
  revision?: number
): Note {
  const note = getNote(database, id);
  if (!note) throw new NoteConflictError('This note no longer exists.');
  if (revision !== undefined && note.revision !== revision)
    throw new NoteConflictError('This note changed in another place. Reload it to continue.');
  const categoryId =
    change.categoryId === undefined
      ? note.categoryId
      : requireCategory(database, change.categoryId);
  database
    .prepare(
      `UPDATE notes SET title = ?, body = ?, category_id = ?, revision = revision + 1,
       updated_at = ? WHERE id = ?`
    )
    .run(
      change.title === undefined ? note.title : change.title.trim(),
      change.body ?? note.body,
      categoryId,
      new Date().toISOString(),
      id
    );
  publishStateChange('pim');
  return getNote(database, id)!;
}

export function deleteNote(database: DatabaseSync, id: number): boolean {
  const deleted = database.prepare('DELETE FROM notes WHERE id = ?').run(id).changes > 0;
  if (deleted) publishStateChange('pim');
  return deleted;
}
