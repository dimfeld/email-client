export function createStateRefresh(
	refresh: () => Promise<void>,
	onError: (error: unknown) => void = console.error
) {
	let running = false;
	let pending = false;
	let stopped = false;

	async function drain() {
		running = true;
		try {
			while (pending && !stopped) {
				pending = false;
				try {
					await refresh();
				} catch (error) {
					onError(error);
				}
			}
		} finally {
			running = false;
		}
	}

	return {
		request() {
			if (stopped) return;
			pending = true;
			if (!running) void drain();
		},
		stop() { stopped = true; }
	};
}
