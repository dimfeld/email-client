import { describe, expect, it, spyOn } from 'bun:test';
import { GmailHistoryQueue } from './gmail-history-queue';
import { GoogleApiError } from './google-api';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Gmail history queue', () => {
  it('combines a burst and only completes notifications covered by the saved cursor', async () => {
    const queue = new GmailHistoryQueue();
    const firstStarted = deferred<void>();
    const firstFinished = deferred<string>();
    const secondStarted = deferred<void>();
    const secondFinished = deferred<string>();
    const targets: Array<string | null> = [];
    let completed = 0;
    const first = queue
      .enqueue('One@Example.com', '101', async (target) => {
        targets.push(target);
        firstStarted.resolve();
        return firstFinished.promise;
      })
      .then(() => {
        completed += 1;
      });
    const second = queue
      .enqueue('one@example.com', '102', async () => {
        throw new Error('Combined notifications must share one sync.');
      })
      .then(() => {
        completed += 1;
      });
    await firstStarted.promise;
    expect(targets).toEqual(['102']);
    expect(completed).toBe(0);
    const covered = queue
      .enqueue('one@example.com', '103', async () => {
        throw new Error('The active sync covers this notification.');
      })
      .then(() => {
        completed += 1;
      });
    const newer = queue
      .enqueue('one@example.com', '105', async (target) => {
        targets.push(target);
        secondStarted.resolve();
        return secondFinished.promise;
      })
      .then(() => {
        completed += 1;
      });
    firstFinished.resolve('104');
    await Promise.all([first, second, covered, secondStarted.promise]);
    expect(completed).toBe(3);
    expect(targets).toEqual(['102', '105']);
    secondFinished.resolve('105');
    await newer;
    expect(completed).toBe(4);
  });

  it('shares exponential retry waits, honors Retry-After, and lets other accounts run', async () => {
    const waits: number[] = [];
    const waiting = [deferred<void>(), deferred<void>(), deferred<void>()];
    const resume = [deferred<void>(), deferred<void>(), deferred<void>()];
    const queue = new GmailHistoryQueue(async (delay) => {
      const index = waits.length;
      waits.push(delay);
      waiting[index].resolve();
      await resume[index].promise;
    });
    const warning = spyOn(console, 'warn').mockImplementation(() => undefined);
    const targets: Array<string | null> = [];
    let completed = false;
    try {
      const first = queue
        .enqueue('one@example.com', '101', async (target) => {
          targets.push(target);
          if (targets.length < 4) {
            throw new GoogleApiError('Rate limited', 429, targets.length === 1 ? 5000 : undefined);
          }
          return target!;
        })
        .then(() => {
          completed = true;
        });
      await waiting[0].promise;
      const newer = queue.enqueue('ONE@example.com', '106', async () => {
        throw new Error('A pending notification must not start its own retry.');
      });
      const poll = queue.enqueue('one@example.com', null, async () => {
        throw new Error('Polling must share the retry wait.');
      });
      await queue.enqueue('two@example.com', '201', async () => '201');
      expect(completed).toBe(false);
      expect(targets).toEqual(['101']);
      resume[0].resolve();
      await waiting[1].promise;
      resume[1].resolve();
      await waiting[2].promise;
      expect(waits).toEqual([5000, 2000, 4000]);
      expect(completed).toBe(false);
      resume[2].resolve();
      await Promise.all([first, newer, poll]);
      expect(targets).toEqual(['101', '106', '106', '106']);
      expect(completed).toBe(true);
      await queue.enqueue('one@example.com', '107', async () => '107');
    } finally {
      warning.mockRestore();
    }
  });

  it('rejects pending notifications on other errors and permits a later sync', async () => {
    const queue = new GmailHistoryQueue();
    const error = new GoogleApiError('Access denied', 403);
    const first = queue.enqueue('one@example.com', '101', async () => {
      throw error;
    });
    const second = queue.enqueue('one@example.com', '102', async () => '102');
    const results = await Promise.allSettled([first, second]);
    expect(results).toEqual([
      { status: 'rejected', reason: error },
      { status: 'rejected', reason: error },
    ]);
    await queue.enqueue('one@example.com', '102', async () => '102');
  });
});
