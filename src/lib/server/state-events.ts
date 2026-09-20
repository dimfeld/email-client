const listenersKey = Symbol.for('email-check.state-listeners');
const shared = globalThis as typeof globalThis & { [listenersKey]?: Set<() => void> };
const listeners = shared[listenersKey] ??= new Set<() => void>();
let pending = false;

export function publishStateChange(): void {
	if (pending || listeners.size === 0) return;
	pending = true;
	queueMicrotask(() => {
		pending = false;
		for (const notify of listeners) notify();
	});
}

export function createStateEvents(signal: AbortSignal): Response {
	const frame = new TextEncoder().encode('data: changed\n\n');
	let closed = false;
	let notify: () => void;
	let onAbort: () => void;
	const cleanup = () => {
		closed = true;
		listeners.delete(notify);
		signal.removeEventListener('abort', onAbort);
	};
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			notify = () => {
				// An unread signal already tells the client to fetch the latest state.
				if (!closed && controller.desiredSize !== null && controller.desiredSize > 0) {
					controller.enqueue(frame);
				}
			};
			onAbort = () => {
				if (closed) return;
				cleanup();
				controller.close();
			};
			if (signal.aborted) { onAbort(); return; }
			signal.addEventListener('abort', onAbort, { once: true });
			listeners.add(notify);
			// Every connection refreshes, including reconnects after missed changes.
			notify();
		},
		cancel: cleanup
	});
	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-store, no-transform',
			'x-accel-buffering': 'no'
		}
	});
}
