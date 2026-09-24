import type { DatabaseSync } from 'node:sqlite';
import { getDatabase, listAccounts } from './db';
import { applyGmailThreadAction } from './gmail-actions';
import { GMAIL_BACKFILL_INTERVAL_MS } from './gmail-backfill';
import { googleApiRequest, type GoogleAccount } from './google-api';
import { publishStateChange } from './state-events';

type ThreadActionResult = Awaited<ReturnType<typeof applyGmailThreadAction>>;

function threadKey(database: DatabaseSync, emailId: number): string | null {
  const row = database.prepare('SELECT thread_key FROM emails WHERE id = ?').get(emailId) as
    | { thread_key: string }
    | undefined;
  return row?.thread_key ?? null;
}

/**
 * Archives the thread and keeps the archived messages to return them to the inbox later.
 * The caller wakes `snoozeWorker()` so the worker sees the new time.
 */
export async function snoozeThread(
  database: DatabaseSync,
  account: GoogleAccount,
  emailId: number,
  wakeAt: number,
  request: typeof googleApiRequest = googleApiRequest
): Promise<ThreadActionResult> {
  const key = threadKey(database, emailId);
  const result = await applyGmailThreadAction(
    database,
    account,
    emailId,
    'archive',
    undefined,
    request
  );
  if (key && result.succeededIds.length) {
    database
      .prepare('DELETE FROM snoozes WHERE account_email = ? AND thread_key = ?')
      .run(account.email, key);
    database
      .prepare(`INSERT INTO snoozes (account_email, thread_key, email_ids_json, wake_at, created_at)
        VALUES (?, ?, ?, ?, ?)`)
      .run(
        account.email,
        key,
        JSON.stringify(result.succeededIds),
        wakeAt,
        new Date().toISOString()
      );
    publishStateChange('mail');
  }
  return result;
}

/** Undo for a snooze: the messages go back to the inbox now. */
export async function cancelSnooze(
  database: DatabaseSync,
  account: GoogleAccount,
  emailId: number,
  succeededIds: number[],
  request: typeof googleApiRequest = googleApiRequest
): Promise<ThreadActionResult> {
  const result = await applyGmailThreadAction(
    database,
    account,
    emailId,
    'unarchive',
    succeededIds,
    request
  );
  const key = threadKey(database, emailId);
  if (key && !result.error) {
    database
      .prepare('DELETE FROM snoozes WHERE account_email = ? AND thread_key = ?')
      .run(account.email, key);
    publishStateChange('mail');
  }
  return result;
}

/**
 * Returns each thread whose snooze has ended to the inbox and stars it, so it stands out.
 * A Gmail failure retries later.
 */
export async function wakeDueSnoozes(
  database: DatabaseSync,
  now = Date.now(),
  request: typeof googleApiRequest = googleApiRequest
): Promise<void> {
  const due = database
    .prepare(`SELECT id, account_email, email_ids_json, retry_count FROM snoozes
      WHERE wake_at <= ? ORDER BY wake_at`)
    .all(now) as {
    id: number;
    account_email: string;
    email_ids_json: string;
    retry_count: number;
  }[];
  const deleteRow = database.prepare('DELETE FROM snoozes WHERE id = ?');
  const remove = (id: number) => {
    deleteRow.run(id);
    publishStateChange('mail');
  };
  // Messages moved to Trash while snoozed stay in Trash.
  const present = database.prepare('SELECT 1 FROM emails WHERE id = ? AND deleted_at IS NULL');
  for (const snooze of due) {
    const account = listAccounts(database).find((item) => item.email === snooze.account_email);
    const ids = (JSON.parse(snooze.email_ids_json) as number[]).filter((id) => present.get(id));
    if (!account || ids.length === 0) {
      remove(snooze.id);
      continue;
    }
    let result: ThreadActionResult;
    try {
      result = await applyGmailThreadAction(database, account, ids[0], 'unarchive', ids, request);
      if (!result.error) {
        const star = await applyGmailThreadAction(
          database,
          account,
          ids[0],
          'star',
          undefined,
          request
        );
        // A retry adds INBOX again, which has no effect, and then tries the star again.
        if (star.error) result = { ...star, succeededIds: [] };
      }
    } catch (error) {
      result = {
        succeededIds: [],
        total: ids.length,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (!result.error) {
      remove(snooze.id);
      continue;
    }
    // The same backoff as historical imports.
    const remaining = ids.filter((id) => !result.succeededIds.includes(id));
    database
      .prepare(`UPDATE snoozes SET email_ids_json = ?, wake_at = ?, retry_count = retry_count + 1,
        error = ? WHERE id = ?`)
      .run(
        JSON.stringify(remaining),
        now + 1000 * 2 ** snooze.retry_count,
        result.error,
        snooze.id
      );
  }
}

export type SnoozeWorker = { wake(): void; close(): void };

export function startSnoozeWorker(database: DatabaseSync): SnoozeWorker {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let closed = false;
  const run = async () => {
    if (running || closed) return;
    running = true;
    try {
      await wakeDueSnoozes(database);
    } catch (error) {
      console.error('Snooze wake failed.', error);
    } finally {
      running = false;
      if (!closed) {
        const next = database.prepare('SELECT min(wake_at) AS next FROM snoozes').get() as {
          next: number | null;
        };
        // Like the outbox, check at least as often as the Gmail backfill runs.
        const delay =
          next.next === null
            ? GMAIL_BACKFILL_INTERVAL_MS
            : Math.min(GMAIL_BACKFILL_INTERVAL_MS, Math.max(0, next.next - Date.now()));
        timer = setTimeout(() => void run(), delay);
        timer.unref();
      }
    }
  };
  const worker = {
    wake() {
      if (timer) clearTimeout(timer);
      void run();
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
    },
  };
  worker.wake();
  return worker;
}

const key = Symbol.for('email-check.snooze');
const shared = globalThis as typeof globalThis & { [key]?: SnoozeWorker };
export function snoozeWorker(): SnoozeWorker {
  return (shared[key] ??= startSnoozeWorker(getDatabase()));
}
