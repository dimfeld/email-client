// Notes and to-dos. A to-do with a due date is a reminder. Notes and to-dos share one list of
// user categories. The FTS tables use the row IDs.
export const pimSchema = `
CREATE TABLE IF NOT EXISTS pim_categories (
 id INTEGER PRIMARY KEY,
 name TEXT NOT NULL COLLATE NOCASE UNIQUE,
 position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
 id INTEGER PRIMARY KEY,
 title TEXT NOT NULL DEFAULT '',
 body TEXT NOT NULL DEFAULT '',
 category_id INTEGER REFERENCES pim_categories(id) ON DELETE SET NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS todos (
 id INTEGER PRIMARY KEY,
 title TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 category_id INTEGER REFERENCES pim_categories(id) ON DELETE SET NULL,
 position INTEGER NOT NULL,
 due_date TEXT,
 due_time TEXT,
 completed_at TEXT,
 source_email_id INTEGER REFERENCES emails(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_todos_category ON todos(category_id, position);

CREATE VIRTUAL TABLE IF NOT EXISTS note_fts USING fts5(title, body);
CREATE TRIGGER IF NOT EXISTS note_fts_insert AFTER INSERT ON notes BEGIN
 INSERT INTO note_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
END;
CREATE TRIGGER IF NOT EXISTS note_fts_delete AFTER DELETE ON notes BEGIN
 DELETE FROM note_fts WHERE rowid = old.id;
END;
CREATE TRIGGER IF NOT EXISTS note_fts_update AFTER UPDATE OF title, body ON notes BEGIN
 DELETE FROM note_fts WHERE rowid = old.id;
 INSERT INTO note_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS todo_fts USING fts5(title, description);
CREATE TRIGGER IF NOT EXISTS todo_fts_insert AFTER INSERT ON todos BEGIN
 INSERT INTO todo_fts(rowid, title, description) VALUES (new.id, new.title, new.description);
END;
CREATE TRIGGER IF NOT EXISTS todo_fts_delete AFTER DELETE ON todos BEGIN
 DELETE FROM todo_fts WHERE rowid = old.id;
END;
CREATE TRIGGER IF NOT EXISTS todo_fts_update AFTER UPDATE OF title, description ON todos BEGIN
 DELETE FROM todo_fts WHERE rowid = old.id;
 INSERT INTO todo_fts(rowid, title, description) VALUES (new.id, new.title, new.description);
END;`;

/**
 * An FTS5 query for notes and to-dos. Words match as prefixes and quoted text matches as a
 * phrase. Returns null when the query has no words, or when it has a mail filter such as
 * `from:`, because those filters do not apply to notes and to-dos.
 */
export function pimMatchQuery(query: string): string | null {
  const tokens = query.match(/(?:[^\s"]|"[^"]*")+/g) ?? [];
  const terms: string[] = [];
  for (const token of tokens) {
    if (/^[a-z]+:/i.test(token)) return null;
    const phrase = /^"(.*)"$/.exec(token);
    const value = (phrase ? phrase[1] : token).replaceAll('"', '');
    if (!/[\p{L}\p{N}]/u.test(value)) continue;
    terms.push(phrase ? `"${value}"` : `"${value}"*`);
  }
  return terms.length ? terms.join(' AND ') : null;
}
