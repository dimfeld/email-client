import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { isDateKey } from '$lib/calendar';
import { createJevClassifier, type EmailClassifier } from './classifier';
import {
  getDatabase,
  getIncomingEmail,
  listAccounts,
  markArchived,
  markDeleted,
  saveClassification,
  saveClassificationError,
  upsertEmails,
} from './db';
import {
  getGmailMessage,
  googleApiRequest,
  GoogleApiError,
  isGoogleRateLimitError,
} from './google-api';
import { GOOGLE_SYNC_PAGE_DELAY_MS } from './google-sync';
import { GMAIL_BACKFILL_INTERVAL_MS } from './gmail-backfill';
import { publishStateChange } from './state-events';

export type HistoricalBackfill = {
  id: string;
  accountEmail: string;
  query: string;
  status: 'queued' | 'running' | 'paused' | 'complete' | 'failed';
  pageToken: string | null;
  pendingIds: string[];
  exhausted: boolean;
  processed: number;
  downloaded: number;
  missing: number;
  classify: boolean;
  delayMs: number;
  retryCount: number;
  nextRunAt: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};
function fromRow(row: Record<string, unknown>): HistoricalBackfill {
  return {
    id: String(row.id),
    accountEmail: String(row.account_email),
    query: String(row.query),
    status: row.status as HistoricalBackfill['status'],
    pageToken: row.page_token as string | null,
    pendingIds: JSON.parse(String(row.pending_ids_json)),
    exhausted: Boolean(row.exhausted),
    processed: Number(row.processed),
    downloaded: Number(row.downloaded),
    missing: Number(row.missing),
    classify: Boolean(row.classify),
    delayMs: Number(row.delay_ms),
    retryCount: Number(row.retry_count),
    nextRunAt: Number(row.next_run_at),
    error: row.error as string | null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
export function listHistoricalBackfills(database: DatabaseSync): HistoricalBackfill[] {
  return database
    .prepare('SELECT * FROM historical_backfills ORDER BY created_at DESC')
    .all()
    .map(fromRow);
}
export function getHistoricalBackfill(
  database: DatabaseSync,
  id: string
): HistoricalBackfill | null {
  const row = database.prepare('SELECT * FROM historical_backfills WHERE id = ?').get(id);
  return row ? fromRow(row) : null;
}

export function createHistoricalBackfill(
  database: DatabaseSync,
  input: {
    account: string;
    query: string;
    after?: string;
    before?: string;
    classify: boolean;
    delayMs: number;
  },
  now = new Date()
): string {
  const account = listAccounts(database).find((account) => account.email === input.account);
  if (!account?.enabled || !account.refreshToken)
    throw new Error('Connect and enable this account before starting an import.');
  for (const date of [input.after, input.before])
    if (date && !isDateKey(date)) throw new Error('Use valid dates for the import range.');
  if (input.after && input.before && input.after >= input.before)
    throw new Error('The end date must be after the start date.');
  if (!Number.isFinite(input.delayMs) || input.delayMs <= 0)
    throw new Error('Choose a positive request delay.');
  // Use Gmail epoch date filters to avoid Gmail's default date time zone. Keep new mail outside this import.
  const query = [
    input.query.trim() ? `(${input.query.trim()})` : '',
    input.after ? `after:${Date.parse(`${input.after}T00:00:00Z`) / 1000}` : '',
    input.before ? `before:${Date.parse(`${input.before}T00:00:00Z`) / 1000}` : '',
    `before:${Math.floor(now.getTime() / 1000)}`,
  ]
    .filter(Boolean)
    .join(' ');
  const id = randomUUID();
  database
    .prepare(`INSERT INTO historical_backfills(id, account_email, query, status, classify, delay_ms, next_run_at, created_at, updated_at)
		VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?)`)
    .run(
      id,
      input.account,
      query,
      Number(input.classify),
      input.delayMs,
      now.getTime(),
      now.toISOString(),
      now.toISOString()
    );
  publishStateChange('backfill');
  return id;
}

export function setHistoricalBackfillPaused(
  database: DatabaseSync,
  id: string,
  paused: boolean,
  now = Date.now()
): void {
  const job = getHistoricalBackfill(database, id);
  if (!job || job.status === 'complete') throw new Error('This import is no longer active.');
  database
    .prepare(
      `UPDATE historical_backfills SET status = ?, next_run_at = ?, error = NULL, retry_count = 0, updated_at = ? WHERE id = ?`
    )
    .run(
      paused ? 'paused' : 'queued',
      paused ? job.nextRunAt : Math.max(now, job.nextRunAt),
      new Date(now).toISOString(),
      id
    );
  publishStateChange('backfill');
}

type MessagePage = { messages?: { id?: string }[]; nextPageToken?: string };
type BackfillDependencies = {
  database: DatabaseSync;
  request?: typeof googleApiRequest;
  getMessage?: typeof getGmailMessage;
  classify?: EmailClassifier;
  now?: () => number;
};
const inFlight = new WeakMap<DatabaseSync, Promise<boolean>>();

export function runHistoricalBackfillStep(dependencies: BackfillDependencies): Promise<boolean> {
  const existing = inFlight.get(dependencies.database);
  if (existing) return existing;
  const promise = runStep(dependencies).finally(() => inFlight.delete(dependencies.database));
  inFlight.set(dependencies.database, promise);
  return promise;
}

async function runStep({
  database,
  request = googleApiRequest,
  getMessage = getGmailMessage,
  classify,
  now = Date.now,
}: BackfillDependencies): Promise<boolean> {
  const row = database
    .prepare(
      `SELECT * FROM historical_backfills WHERE status IN ('queued','running') AND next_run_at <= ? ORDER BY next_run_at, created_at LIMIT 1`
    )
    .get(now());
  if (!row) return false;
  const job = fromRow(row);
  const account = listAccounts(database).find((account) => account.email === job.accountEmail);
  const update = (sql: string, params: (string | number | null)[]) => {
    database
      .prepare(`UPDATE historical_backfills SET ${sql}, updated_at = ? WHERE id = ?`)
      .run(...params, new Date(now()).toISOString(), job.id);
    publishStateChange('backfill');
  };
  if (!account?.enabled || !account.refreshToken) {
    update("status = 'failed', error = ?", [
      'Connect and enable the account, then resume this import.',
    ]);
    return true;
  }
  update("status = 'running'", []);
  try {
    if (job.pendingIds.length === 0) {
      if (job.exhausted) {
        update("status = 'complete', error = NULL", []);
        return true;
      }
      // Omit maxResults: use the Gmail API page size, without a local mailbox-size limit.
      const page = await request<MessagePage>(
        account,
        'https://gmail.googleapis.com/gmail/v1/users/me/messages',
        { params: { q: job.query, pageToken: job.pageToken ?? undefined } }
      );
      const ids = [
        ...new Set((page.messages ?? []).flatMap((message) => (message.id ? [message.id] : []))),
      ];
      update(
        'pending_ids_json = ?, page_token = ?, exhausted = ?, retry_count = 0, error = NULL, next_run_at = ?',
        [
          JSON.stringify(ids),
          page.nextPageToken ?? null,
          Number(!page.nextPageToken),
          now() + job.delayMs,
        ]
      );
      return true;
    }
    const id = job.pendingIds[0];
    const alreadyDone = database
      .prepare('SELECT 1 FROM historical_backfill_messages WHERE job_id = ? AND gmail_id = ?')
      .get(job.id, id);
    let missing = false;
    if (!alreadyDone) {
      try {
        const email =
          getIncomingEmail(database, account.email, id) ?? (await getMessage(account, id));
        if (email.id !== id) throw new Error('Gmail returned a different message ID.');
        const pending = upsertEmails(database, account.email, [email]);
        if (email.labels?.includes('TRASH')) markDeleted(database, account.email, [id]);
        else if (!email.labels?.includes('INBOX')) markArchived(database, account.email, [id]);
        if (job.classify && pending.length) {
          try {
            saveClassification(
              database,
              account.email,
              id,
              await (classify ?? createJevClassifier())(email, account.email)
            );
          } catch (error) {
            saveClassificationError(database, account.email, id, error);
            throw error;
          }
        }
      } catch (error) {
        if (error instanceof GoogleApiError && error.status === 404) {
          missing = true;
          markDeleted(database, account.email, [id]);
        } else throw error;
      }
    }
    database.exec('BEGIN IMMEDIATE');
    try {
      if (!alreadyDone)
        database
          .prepare('INSERT INTO historical_backfill_messages(job_id, gmail_id) VALUES (?, ?)')
          .run(job.id, id);
      update(
        'pending_ids_json = ?, processed = processed + ?, downloaded = downloaded + ?, missing = missing + ?, retry_count = 0, error = NULL, next_run_at = ?',
        [
          JSON.stringify(job.pendingIds.slice(1)),
          Number(!alreadyDone),
          Number(!alreadyDone && !missing),
          Number(!alreadyDone && missing),
          now() + job.delayMs,
        ]
      );
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      job.pendingIds.length === 0 &&
      job.pageToken &&
      error instanceof GoogleApiError &&
      error.status === 400 &&
      /page.*token|token.*page/i.test(message)
    ) {
      update('page_token = NULL, next_run_at = ?, error = ?', [
        now() + job.delayMs,
        'The page token expired. Resuming from the start; completed messages will be skipped.',
      ]);
    } else if (
      isGoogleRateLimitError(error) ||
      (error instanceof GoogleApiError && (error.status === undefined || error.status >= 500)) ||
      error instanceof TypeError
    ) {
      // Google's Gmail error guide requires at least one second and exponential backoff.
      const delay = Math.max(
        job.delayMs,
        1000 * 2 ** job.retryCount,
        error instanceof GoogleApiError ? (error.retryAfterMs ?? 0) : 0
      );
      update('retry_count = retry_count + 1, next_run_at = ?, error = ?', [now() + delay, message]);
    } else {
      update("status = CASE WHEN status = 'paused' THEN status ELSE 'failed' END, error = ?", [
        message,
      ]);
    }
  }
  return true;
}

export type HistoricalBackfillWorker = { wake(): void; close(): void };
export function startHistoricalBackfill(
  dependencies: BackfillDependencies
): HistoricalBackfillWorker {
  let closed = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    if (closed || running) return;
    running = true;
    try {
      await runHistoricalBackfillStep(dependencies);
    } catch (error) {
      console.error('Historical mail import failed.', error);
    } finally {
      running = false;
      if (!closed) {
        const next = dependencies.database
          .prepare(
            "SELECT min(next_run_at) AS next FROM historical_backfills WHERE status IN ('queued','running')"
          )
          .get() as { next: number | null };
        // Reuse the reconciliation interval to discover work started by another local process.
        const delay =
          next.next === null
            ? GMAIL_BACKFILL_INTERVAL_MS
            : Math.min(
                GMAIL_BACKFILL_INTERVAL_MS,
                Math.max(0, next.next - (dependencies.now ?? Date.now)())
              );
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

const workerKey = Symbol.for('email-check.historical-backfill');
const shared = globalThis as typeof globalThis & { [workerKey]?: HistoricalBackfillWorker };
export function historicalBackfillWorker(): HistoricalBackfillWorker {
  return (shared[workerKey] ??= startHistoricalBackfill({ database: getDatabase() }));
}

// Match existing Google sync pacing; users can choose a longer delay in Settings.
export const defaultHistoricalDelayMs = GOOGLE_SYNC_PAGE_DELAY_MS;
