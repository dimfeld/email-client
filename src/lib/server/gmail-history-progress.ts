import type { DatabaseSync } from 'node:sqlite';
import type { IncomingEmail } from './types';

export const gmailHistorySchema = `
CREATE TABLE IF NOT EXISTS gmail_history_progress (
  account_email TEXT PRIMARY KEY REFERENCES accounts(email) ON DELETE CASCADE,
  start_history_id TEXT NOT NULL,
  history_id TEXT NOT NULL,
  changes_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gmail_history_downloads (
  account_email TEXT NOT NULL REFERENCES gmail_history_progress(account_email) ON DELETE CASCADE,
  gmail_id TEXT NOT NULL,
  message_json TEXT,
  PRIMARY KEY (account_email, gmail_id)
);`;

export type GmailHistoryChange = {
  id: string;
  added: boolean;
  deleted: boolean;
  fetch: boolean;
  labels: Record<string, boolean>;
};

export type GmailHistoryProgress = {
  startHistoryId: string;
  historyId: string;
  changes: GmailHistoryChange[];
};

export function loadGmailHistoryProgress(
  database: DatabaseSync,
  account: string,
  startHistoryId: string
): GmailHistoryProgress | null {
  const row = database
    .prepare('SELECT * FROM gmail_history_progress WHERE account_email = ?')
    .get(account) as
    | { start_history_id: string; history_id: string; changes_json: string }
    | undefined;
  if (!row) return null;
  if (row.start_history_id !== startHistoryId) {
    clearGmailHistoryProgress(database, account);
    return null;
  }
  return {
    startHistoryId: row.start_history_id,
    historyId: row.history_id,
    changes: JSON.parse(row.changes_json) as GmailHistoryChange[],
  };
}

export function saveGmailHistoryProgress(
  database: DatabaseSync,
  account: string,
  progress: GmailHistoryProgress
): void {
  database
    .prepare(`INSERT INTO gmail_history_progress
      (account_email, start_history_id, history_id, changes_json) VALUES (?, ?, ?, ?)`)
    .run(account, progress.startHistoryId, progress.historyId, JSON.stringify(progress.changes));
}

export function clearGmailHistoryProgress(database: DatabaseSync, account: string): void {
  database.prepare('DELETE FROM gmail_history_progress WHERE account_email = ?').run(account);
}

export function loadGmailHistoryDownload(
  database: DatabaseSync,
  account: string,
  id: string
): IncomingEmail | null | undefined {
  const row = database
    .prepare(
      'SELECT message_json FROM gmail_history_downloads WHERE account_email = ? AND gmail_id = ?'
    )
    .get(account, id) as { message_json: string | null } | undefined;
  if (!row) return undefined;
  return row.message_json === null ? null : (JSON.parse(row.message_json) as IncomingEmail);
}

export function saveGmailHistoryDownload(
  database: DatabaseSync,
  account: string,
  id: string,
  message: IncomingEmail | null
): void {
  database
    .prepare(
      'INSERT INTO gmail_history_downloads (account_email, gmail_id, message_json) VALUES (?, ?, ?)'
    )
    .run(account, id, message === null ? null : JSON.stringify(message));
}
