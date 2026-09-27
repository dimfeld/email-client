import type { DatabaseSync } from 'node:sqlite';
import type { PimCategory } from '$lib/pim';
import { publishStateChange } from './state-events';

/** An input error for notes, to-dos, or their categories. The message is for the user. */
export class PimValidationError extends Error {}

export function listPimCategories(database: DatabaseSync): PimCategory[] {
  return (
    database.prepare('SELECT id, name FROM pim_categories ORDER BY position, id').all() as {
      id: number;
      name: string;
    }[]
  ).map((row) => ({ id: Number(row.id), name: row.name }));
}

/** Returns the category ID, or throws when the category does not exist. */
export function requireCategory(database: DatabaseSync, id: number | null): number | null {
  if (id === null) return null;
  if (!database.prepare('SELECT 1 FROM pim_categories WHERE id = ?').get(id))
    throw new PimValidationError('The category no longer exists.');
  return id;
}

function categoryName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new PimValidationError('Enter a category name.');
  return trimmed;
}

function findCategory(database: DatabaseSync, name: string): PimCategory | null {
  const row = database.prepare('SELECT id, name FROM pim_categories WHERE name = ?').get(name) as
    | { id: number; name: string }
    | undefined;
  return row ? { id: Number(row.id), name: row.name } : null;
}

export function createPimCategory(database: DatabaseSync, name: string): PimCategory {
  const value = categoryName(name);
  if (findCategory(database, value))
    throw new PimValidationError(`A category named “${value}” already exists.`);
  const result = database
    .prepare(
      `INSERT INTO pim_categories (name, position)
       VALUES (?, (SELECT COALESCE(MAX(position), -1) + 1 FROM pim_categories))`
    )
    .run(value);
  publishStateChange('pim');
  return { id: Number(result.lastInsertRowid), name: value };
}

/** Finds a category by name, ignoring case, and creates it when it does not exist. */
export function ensurePimCategory(database: DatabaseSync, name: string): PimCategory {
  return findCategory(database, categoryName(name)) ?? createPimCategory(database, name);
}

export function renamePimCategory(database: DatabaseSync, id: number, name: string): void {
  const value = categoryName(name);
  const existing = findCategory(database, value);
  if (existing && existing.id !== id)
    throw new PimValidationError(`A category named “${value}” already exists.`);
  if (database.prepare('UPDATE pim_categories SET name = ? WHERE id = ?').run(value, id).changes)
    publishStateChange('pim');
}

/** Deletes the category. Its notes and to-dos stay, without a category. */
export function deletePimCategory(database: DatabaseSync, id: number): void {
  database.exec('BEGIN IMMEDIATE');
  try {
    // Moved to-dos go after the to-dos that already have no category, in their current order.
    const { next } = database
      .prepare(
        'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM todos WHERE category_id IS NULL'
      )
      .get() as { next: number };
    database
      .prepare('UPDATE todos SET category_id = NULL, position = position + ? WHERE category_id = ?')
      .run(next, id);
    database.prepare('DELETE FROM pim_categories WHERE id = ?').run(id);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  publishStateChange('pim');
}
