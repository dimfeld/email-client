import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import {
	MessageArrivalStats,
	MESSAGE_STATS_DAY_MS,
	MESSAGE_STATS_HOUR_MS
} from './message-arrival-stats';

describe('message arrival stats', () => {
	it('keeps separate rolling counts for each arrival source', () => {
		const stats = new MessageArrivalStats();
		const now = Date.parse('2026-09-20T12:00:00.000Z');

		stats.record('pubsub', 2, now - 30 * 60 * 1000);
		stats.record('backfill', 3, now - 2 * 60 * 60 * 1000);
		stats.record('pubsub', 5, now - MESSAGE_STATS_DAY_MS - 1);

		expect(stats.snapshot(now)).toEqual({
			lastHour: { pubsub: 2, backfill: 0 },
			last24Hours: { pubsub: 2, backfill: 3 }
		});
	});

	it('logs rolling counts after a non-empty arrival', () => {
		const log = spyOn(console, 'log').mockImplementation(() => undefined);
		try {
			const stats = new MessageArrivalStats();
			const now = Date.parse('2026-09-20T12:00:00.000Z');

			stats.recordAndLog('backfill', 4, now);

			expect(log).toHaveBeenCalledWith('Gmail message arrival stats.', {
				lastHour: { pubsub: 0, backfill: 4 },
				last24Hours: { pubsub: 0, backfill: 4 }
			});
			expect(MESSAGE_STATS_HOUR_MS).toBe(60 * 60 * 1000);
		} finally {
			log.mockRestore();
		}
	});
});
