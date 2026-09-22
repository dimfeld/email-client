import type { DatabaseSync } from 'node:sqlite';
import { getDatabase } from './db';
import { recoverInterruptedSends, sendNextDraft } from './composer';
import { GMAIL_BACKFILL_INTERVAL_MS } from './gmail-backfill';
export type OutboxWorker = { wake(): void; close(): void };
export function startOutbox(database: DatabaseSync): OutboxWorker {
  recoverInterruptedSends(database);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let closed = false;
  const run = async () => {
    if (running || closed) return;
    running = true;
    try {
      await sendNextDraft(database);
    } catch (error) {
      console.error('Outbox failed.', error);
    } finally {
      running = false;
      if (!closed) {
        const next = database
          .prepare("SELECT min(send_at) AS next FROM email_drafts WHERE status = 'queued'")
          .get() as { next: number | null };
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
const key = Symbol.for('email-check.outbox');
const shared = globalThis as typeof globalThis & { [key]?: OutboxWorker };
export function outboxWorker(): OutboxWorker {
  return (shared[key] ??= startOutbox(getDatabase()));
}
