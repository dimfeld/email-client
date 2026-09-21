export type MessageArrivalSource = 'pubsub' | 'backfill';

export type MessageArrivalEvent = {
	accountEmail: string;
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

function normalizeAccountEmail(accountEmail: string): string {
	return accountEmail.trim().toLowerCase();
}

export class MessageArrivalStats {
	private readonly events: MessageArrivalEvent[] = [];

	record(accountEmail: string, source: MessageArrivalSource, count: number, at = Date.now()): void {
		if (count <= 0) return;
		this.events.push({ accountEmail: normalizeAccountEmail(accountEmail), source, count, at });
		this.removeExpired(at);
	}

	snapshot(accountEmail: string, at = Date.now()): MessageArrivalStatsSnapshot {
		this.removeExpired(at);
		const normalizedAccountEmail = normalizeAccountEmail(accountEmail);
		return {
			lastHour: this.countSince(normalizedAccountEmail, at - MESSAGE_STATS_HOUR_MS),
			last24Hours: this.countSince(normalizedAccountEmail, at - MESSAGE_STATS_DAY_MS)
		};
	}

	snapshotByAccount(at = Date.now()): Record<string, MessageArrivalStatsSnapshot> {
		this.removeExpired(at);
		const accounts = new Set(this.events.map((event) => event.accountEmail));
		return Object.fromEntries(
			[...accounts].sort().map((accountEmail) => [accountEmail, this.snapshot(accountEmail, at)])
		);
	}

	log(accountEmail: string, at = Date.now()): void {
		const normalizedAccountEmail = normalizeAccountEmail(accountEmail);
		console.log('Gmail message arrival stats.', {
			account: normalizedAccountEmail,
			...this.snapshot(normalizedAccountEmail, at)
		});
	}

	recordAndLog(accountEmail: string, source: MessageArrivalSource, count: number, at = Date.now()): void {
		if (count <= 0) return;
		this.record(accountEmail, source, count, at);
		this.log(accountEmail, at);
	}

	private removeExpired(at: number): void {
		const cutoff = at - MESSAGE_STATS_DAY_MS;
		for (let index = this.events.length - 1; index >= 0; index -= 1) {
			if (this.events[index].at < cutoff) this.events.splice(index, 1);
		}
	}

	private countSince(accountEmail: string, cutoff: number): MessageArrivalCounts {
		const counts = emptyCounts();
		for (const event of this.events) {
			if (event.accountEmail === accountEmail && event.at >= cutoff) counts[event.source] += event.count;
		}
		return counts;
	}
}

const statsKey = Symbol.for('email-check.gmail-message-arrival-stats');
const shared = globalThis as typeof globalThis & {
	[statsKey]?: MessageArrivalStats;
};

export const gmailMessageArrivalStats = shared[statsKey] ??= new MessageArrivalStats();
