import type { StateScope } from '$lib/state-scopes';

const listenersKey = Symbol.for('email-check.state-listeners');
const shared = globalThis as typeof globalThis & {
  [listenersKey]?: Set<(scopes: Iterable<StateScope>) => void>;
};
const listeners = (shared[listenersKey] ??= new Set());
const pendingScopes = new Set<StateScope>();

export function publishStateChange(scope: StateScope = 'all'): void {
  if (listeners.size === 0) return;
  const first = pendingScopes.size === 0;
  pendingScopes.add(scope);
  if (!first) return;
  queueMicrotask(() => {
    const scopes = [...pendingScopes];
    pendingScopes.clear();
    for (const notify of listeners) notify(scopes);
  });
}

export function createStateEvents(signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  // Scopes that the client has not read yet. A slow client gets one merged frame.
  const unsent = new Set<StateScope>();
  let closed = false;
  let notify: (scopes: Iterable<StateScope>) => void;
  let onAbort: () => void;
  const cleanup = () => {
    closed = true;
    listeners.delete(notify);
    signal.removeEventListener('abort', onAbort);
  };
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const flush = () => {
    if (closed || unsent.size === 0) return;
    if (controller.desiredSize === null || controller.desiredSize <= 0) return;
    const scopes = unsent.has('all') ? ['all'] : [...unsent];
    unsent.clear();
    controller.enqueue(encoder.encode(`data: ${scopes.join(',')}\n\n`));
  };
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      notify = (scopes) => {
        for (const scope of scopes) unsent.add(scope);
        flush();
      };
      onAbort = () => {
        if (closed) return;
        cleanup();
        controller.close();
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      listeners.add(notify);
      // Every connection refreshes everything, including reconnects after missed changes.
      notify(['all']);
    },
    pull: () => flush(),
    cancel: cleanup,
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
