import type { StateScope } from './state-scopes';

export function createStateRefresh(
  refresh: (scopes: Set<StateScope>) => Promise<void>,
  onError: (error: unknown) => void = console.error
) {
  let running = false;
  const pending = new Set<StateScope>();
  let stopped = false;
  let paused = false;

  async function drain() {
    running = true;
    try {
      while (pending.size > 0 && !stopped && !paused) {
        const scopes = new Set(pending);
        pending.clear();
        try {
          await refresh(scopes);
        } catch (error) {
          onError(error);
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    /** Queues a refresh. Scopes from requests during a running refresh merge into one. */
    request(scopes: Iterable<StateScope> = ['all']) {
      if (stopped) return;
      for (const scope of scopes) pending.add(scope);
      if (!running && !paused) void drain();
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      if (pending.size > 0 && !running && !stopped) void drain();
    },
    stop() {
      stopped = true;
    },
  };
}
