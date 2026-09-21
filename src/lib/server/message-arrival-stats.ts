export type MessageArrivalSource = 'pubsub' | 'backfill';

export type MessageArrivalEvent = {
	source: MessageArrivalSource;
	count: number;
	at: number;
};

export type MessageArrivalCounts = Record<MessageArrivalSource, number>;

export type MessageArrivalStatsSnapshot = {
	lastHour: MessageArrivalCounts;
	last24Hours: MessageArrivalCounts;
};

export const MESSAGE_STATS_HOUR_MS = 60 * 60 * 1000;
export const MESSAGE_STATS_DAY_MS = 24 * MESSAGE_STATS_HOUR_MS;

function emptyCounts(): MessageArrivalCounts {
	return { pubsub: 0, backfill: 0 };
}

export class MessageArrivalStats {
	private readonly events: MessageArrivalEvent[] = [];

	record(source: MessageArrivalSource, count: number, at = Date.now()): void {
		if (count <= 0) return;
		this.events.push({ source, count, at });
		this.removeExpired(at);
	}

	snapshot(at = Date.now()): MessageArrivalStatsSnapshot {
		this.removeExpired(at);
		return {
			lastHour: this.countSince(at - MESSAGE_STATS_HOUR_MS),
			last24Hours: this.countSince(at - MESSAGE_STATS_DAY_MS)
		};
	}

	log(at = Date.now()): void {
		console.log('Gmail message arrival stats.', this.snapshot(at));
	}

	recordAndLog(source: MessageArrivalSource, count: number, at = Date.now()): void {
		if (count <= 0) return;
		this.record(source, count, at);
		this.log(at);
	}

	private removeExpired(at: number): void {
		const cutoff = at - MESSAGE_STATS_DAY_MS;
		while (this.events[0]?.at < cutoff) this.events.shift();
	}

	private countSince(cutoff: number): MessageArrivalCounts {
		const counts = emptyCounts();
		for (const event of this.events) {
			if (event.at >= cutoff) counts[event.source] += event.count;
		}
		return counts;
	}
}

const statsKey = Symbol.for('email-check.gmail-message-arrival-stats');
const shared = globalThis as typeof globalThis & {
	[statsKey]?: MessageArrivalStats;
};

export const gmailMessageArrivalStats = shared[statsKey] ??= new MessageArrivalStats();
