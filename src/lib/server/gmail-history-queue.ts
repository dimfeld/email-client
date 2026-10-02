import { queueGmailAccountWork } from './gmail-account-queue';
import { GoogleApiError, isGoogleRateLimitError } from './google-api';

type HistoryWork = (historyId: string | null) => Promise<string>;
type PendingSync = {
  historyId: string | null;
  work: HistoryWork;
  resolve: () => void;
  reject: (error: unknown) => void;
};

async function waitForRetry(delayMs: number): Promise<void> {
  // Node timers accept delays up to a signed 32-bit integer. Split longer waits.
  while (delayMs > 0) {
    const interval = Math.min(delayMs, 2 ** 31 - 1);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, interval);
      timer.unref?.();
    });
    delayMs -= interval;
  }
}

export class GmailHistoryQueue {
  private accounts = new Map<string, PendingSync[]>();

  constructor(private wait: (delayMs: number) => Promise<void> = waitForRetry) {}

  enqueue(email: string, historyId: string | null, work: HistoryWork): Promise<void> {
    const key = email.toLowerCase();
    let pending = this.accounts.get(key);
    const start = !pending;
    if (!pending) this.accounts.set(key, (pending = []));
    const result = new Promise<void>((resolve, reject) => {
      pending.push({ historyId, work, resolve, reject });
    });
    if (start) {
      void queueGmailAccountWork(key, () => this.run(key, pending)).catch((error) => {
        this.accounts.delete(key);
        for (const item of pending) item.reject(error);
      });
    }
    return result;
  }

  private async run(email: string, pending: PendingSync[]): Promise<void> {
    let retryCount = 0;
    while (pending.length > 0) {
      const batch = new Set(pending);
      const historyId = pending.reduce<string | null>((latest, item) => {
        if (item.historyId === null) return latest;
        return latest === null || BigInt(item.historyId) > BigInt(latest) ? item.historyId : latest;
      }, null);
      try {
        const cursor = await pending[0].work(historyId);
        retryCount = 0;
        for (let index = pending.length - 1; index >= 0; index -= 1) {
          const item = pending[index];
          if (
            item.historyId === null ? batch.has(item) : BigInt(item.historyId) <= BigInt(cursor)
          ) {
            pending.splice(index, 1);
            item.resolve();
          }
        }
      } catch (error) {
        if (!isGoogleRateLimitError(error)) throw error;
        // Google's Gmail error guide requires at least one second and exponential backoff.
        const delayMs = Math.max(
          1000 * 2 ** retryCount,
          error instanceof GoogleApiError ? (error.retryAfterMs ?? 0) : 0
        );
        retryCount += 1;
        console.warn('Gmail history sync is waiting after a rate limit.', {
          account: email,
          delayMs,
          error,
        });
        await this.wait(delayMs);
      }
    }
    this.accounts.delete(email);
  }
}

const queueKey = Symbol.for('email-check.gmail-history-queue');
const shared = globalThis as typeof globalThis & { [queueKey]?: GmailHistoryQueue };
export const gmailHistoryQueue = (shared[queueKey] ??= new GmailHistoryQueue());
