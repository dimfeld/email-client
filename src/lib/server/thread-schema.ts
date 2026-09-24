import type { DatabaseSync } from 'node:sqlite';

const threadSchema = `
CREATE TABLE IF NOT EXISTS threads (
  account_email TEXT NOT NULL, thread_key TEXT NOT NULL,
  latest_email_id INTEGER NOT NULL, latest_sort_time INTEGER NOT NULL,
  PRIMARY KEY (account_email, thread_key)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS thread_labels (
  account_email TEXT NOT NULL, thread_key TEXT NOT NULL, label TEXT NOT NULL,
  latest_sort_time INTEGER NOT NULL, latest_email_id INTEGER NOT NULL,
  PRIMARY KEY (account_email, thread_key, label)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS thread_labels_view
  ON thread_labels(label, latest_sort_time DESC, latest_email_id DESC);
CREATE INDEX IF NOT EXISTS thread_labels_view_account
  ON thread_labels(account_email, label, latest_sort_time DESC, latest_email_id DESC);
CREATE TABLE IF NOT EXISTS thread_filters (
  account_email TEXT NOT NULL, thread_key TEXT NOT NULL, filter TEXT NOT NULL,
  latest_sort_time INTEGER NOT NULL, latest_email_id INTEGER NOT NULL,
  PRIMARY KEY (account_email, thread_key, filter)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS thread_filters_view
  ON thread_filters(filter, latest_sort_time DESC, latest_email_id DESC);
CREATE INDEX IF NOT EXISTS thread_filters_view_account
  ON thread_filters(account_email, filter, latest_sort_time DESC, latest_email_id DESC);
CREATE INDEX IF NOT EXISTS emails_thread_members
  ON emails(account_email, thread_key, sort_time DESC, id DESC);
`;

function recompute(ref: 'old' | 'new'): string {
  const account = `${ref}.account_email`;
  const key = `${ref}.thread_key`;
  return `
    DELETE FROM thread_labels WHERE account_email = ${account} AND thread_key = ${key};
    DELETE FROM threads WHERE account_email = ${account} AND thread_key = ${key};
    INSERT INTO threads(account_email, thread_key, latest_email_id, latest_sort_time)
      SELECT account_email, thread_key, id, sort_time FROM emails
      WHERE account_email = ${account} AND thread_key = ${key} AND deleted_at IS NULL
      ORDER BY sort_time DESC, id DESC LIMIT 1;
    INSERT INTO thread_labels(account_email, thread_key, label, latest_sort_time, latest_email_id)
      SELECT t.account_email, t.thread_key, j.value, t.latest_sort_time, t.latest_email_id
      FROM threads t JOIN emails e ON e.account_email = t.account_email
        AND e.thread_key = t.thread_key AND e.deleted_at IS NULL
      JOIN json_each(e.labels_json) j
      WHERE t.account_email = ${account} AND t.thread_key = ${key}
      GROUP BY j.value;
    ${recomputeFilters(ref)}
  `;
}

function filterRows(where: string): string {
  const base = `FROM threads t JOIN emails e ON e.account_email = t.account_email
    AND e.thread_key = t.thread_key AND e.deleted_at IS NULL AND e.is_sent = 0 WHERE ${where}`;
  const select = (filter: string, condition: string) =>
    `SELECT t.account_email, t.thread_key, ${filter} AS filter, t.latest_sort_time, t.latest_email_id
      ${base} AND ${condition}`;
  return [
    select("'category:' || e.category", 'e.category IS NOT NULL'),
    select("'pending'", 'e.category IS NULL AND e.in_inbox = 1'),
    select("'important'", "e.importance = 'important'"),
    select("'useful'", "e.importance IN ('important', 'useful')"),
  ].join(' UNION ');
}

function recomputeFilters(ref: 'old' | 'new'): string {
  return `DELETE FROM thread_filters WHERE account_email = ${ref}.account_email AND thread_key = ${ref}.thread_key;
    INSERT INTO thread_filters(account_email, thread_key, filter, latest_sort_time, latest_email_id)
    ${filterRows(`t.account_email = ${ref}.account_email AND t.thread_key = ${ref}.thread_key`)};`;
}

export function rebuildThreadFilters(database: DatabaseSync): void {
  database.exec(`DELETE FROM thread_filters;
    INSERT INTO thread_filters(account_email, thread_key, filter, latest_sort_time, latest_email_id)
    ${filterRows('1')};`);
}

export function rebuildThreads(database: DatabaseSync): void {
  database.exec(`DELETE FROM thread_labels; DELETE FROM threads;
    INSERT INTO threads(account_email, thread_key, latest_email_id, latest_sort_time)
    SELECT account_email, thread_key, id, sort_time FROM (
      SELECT account_email, thread_key, id, sort_time,
        row_number() OVER (PARTITION BY account_email, thread_key ORDER BY sort_time DESC, id DESC) AS position
      FROM emails WHERE deleted_at IS NULL
    ) WHERE position = 1;
    INSERT INTO thread_labels(account_email, thread_key, label, latest_sort_time, latest_email_id)
    SELECT t.account_email, t.thread_key, j.value, t.latest_sort_time, t.latest_email_id
    FROM threads t JOIN emails e ON e.account_email = t.account_email
      AND e.thread_key = t.thread_key AND e.deleted_at IS NULL
    JOIN json_each(e.labels_json) j GROUP BY t.account_email, t.thread_key, j.value;`);
  rebuildThreadFilters(database);
}

export function installThreadSchema(database: DatabaseSync): boolean {
  const columns = database.prepare('PRAGMA table_xinfo(emails)').all() as { name: string }[];
  const has = (name: string) => columns.some((column) => column.name === name);
  if (has('archived_at')) {
    database.exec(`UPDATE emails SET labels_json = (
      SELECT json_group_array(value) FROM json_each(labels_json) WHERE value != 'INBOX'
    ) WHERE archived_at IS NOT NULL;
    ALTER TABLE emails DROP COLUMN archived_at;`);
  }
  if (!has('thread_key'))
    database.exec(`ALTER TABLE emails ADD COLUMN thread_key TEXT
    GENERATED ALWAYS AS (CASE WHEN thread_id IS NOT NULL AND thread_id != ''
      THEN 't:' || thread_id ELSE 'm:' || gmail_id END) VIRTUAL`);
  if (!has('in_inbox'))
    database.exec(`ALTER TABLE emails ADD COLUMN in_inbox INTEGER
    GENERATED ALWAYS AS (instr(labels_json, '"INBOX"') > 0) VIRTUAL`);
  if (!has('is_sent'))
    database.exec(`ALTER TABLE emails ADD COLUMN is_sent INTEGER
    GENERATED ALWAYS AS (instr(labels_json, '"SENT"') > 0) VIRTUAL`);
  const migrated = !has('sort_time');
  if (migrated) {
    database.exec('ALTER TABLE emails ADD COLUMN sort_time INTEGER NOT NULL DEFAULT 0');
    const rows = database.prepare('SELECT id, message_date, first_seen_at FROM emails').all() as {
      id: number;
      message_date: string | null;
      first_seen_at: string;
    }[];
    const update = database.prepare('UPDATE emails SET sort_time = ? WHERE id = ?');
    for (const row of rows) update.run(emailSortTime(row.message_date, row.first_seen_at), row.id);
  }
  // Importance was once derived from the current category level when mail was read. Store the
  // fixed levels on existing messages, so a later level change affects only new messages. A
  // database without the classification trigger is older than that design.
  const exists = (name: string) =>
    Boolean(database.prepare('SELECT name FROM sqlite_master WHERE name = ?').get(name));
  if (!exists('emails_thread_classification') || exists('categories_thread_filters_update'))
    database.exec(`DROP TRIGGER IF EXISTS categories_thread_filters_update;
      UPDATE emails SET importance = (SELECT level FROM categories WHERE id = emails.category)
      WHERE category IN (SELECT id FROM categories WHERE level != 'auto');`);
  const hadFilters = Boolean(
    database.prepare("SELECT name FROM sqlite_master WHERE name = 'thread_filters'").get()
  );
  database.exec(threadSchema);
  if (
    !hadFilters &&
    database.prepare("SELECT name FROM sqlite_master WHERE name = 'emails_thread_insert'").get()
  )
    rebuildThreadFilters(database);
  if (
    !database.prepare("SELECT name FROM sqlite_master WHERE name = 'emails_thread_insert'").get()
  ) {
    rebuildThreads(database);
    database.exec(`
      CREATE TRIGGER emails_thread_insert AFTER INSERT ON emails BEGIN ${recompute('new')} END;
      CREATE TRIGGER emails_thread_delete AFTER DELETE ON emails BEGIN ${recompute('old')} END;
      CREATE TRIGGER emails_thread_update AFTER UPDATE OF thread_id, deleted_at, sort_time, labels_json ON emails
        WHEN old.thread_id IS NOT new.thread_id OR old.deleted_at IS NOT new.deleted_at
          OR old.sort_time IS NOT new.sort_time OR old.labels_json IS NOT new.labels_json
      BEGIN ${recompute('old')} ${recompute('new')} END;
    `);
  }
  database.exec(`CREATE TRIGGER IF NOT EXISTS emails_thread_classification
    AFTER UPDATE OF category, importance ON emails
    WHEN old.category IS NOT new.category OR old.importance IS NOT new.importance
    BEGIN ${recomputeFilters('new')} END;`);
  return migrated;
}

export function emailSortTime(date: string | null | undefined, fallback: string): number {
  const text = date?.trim() ?? '';
  const parsed = /^\d{13}$/.test(text) ? Number(text) : Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Date.parse(fallback);
}
