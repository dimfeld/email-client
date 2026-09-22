import type { DatabaseSync } from 'node:sqlite';
import { getDatabase, listAccounts } from './db';
import { googleApiRequest } from './google-api';
import { syncGoogleAccount, type GoogleSyncOptions } from './google-sync';

// Match the existing Gmail reconciliation interval so Google data has one refresh cadence.
export const GOOGLE_DATA_SYNC_INTERVAL_MS = 5 * 60 * 1000;

type GoogleDataSyncDependencies = {
	database: DatabaseSync;
	request?: typeof googleApiRequest;
	intervalMs?: number;
	syncOptions?: GoogleSyncOptions;
};

export type GoogleDataSyncResult = {
	accounts: number;
	succeeded: number;
	failed: number;
	deferred: number;
};

export async function syncGoogleData({
	database,
	request = googleApiRequest,
	syncOptions
}: Pick<GoogleDataSyncDependencies, 'database' | 'request' | 'syncOptions'>): Promise<GoogleDataSyncResult> {
	const accounts = listAccounts(database).filter((account) => account.enabled && account.refreshToken);
	const results = await Promise.all(accounts.map(async (account) => {
		try {
			const result = await syncGoogleAccount(database, account, request, syncOptions);
			if (result.deferred) console.warn(`Google data sync deferred for ${account.email} because of a rate limit.`);
			return { ok: true, deferred: Boolean(result.deferred) };
		} catch (error) {
			console.error(`Google data sync failed for ${account.email}.`, error);
			return { ok: false, deferred: false };
		}
	}));
	return {
		accounts: accounts.length,
		succeeded: results.filter((result) => result.ok).length,
		failed: results.filter((result) => !result.ok).length,
		deferred: results.filter((result) => result.deferred).length
	};
}

export type GoogleDataSync = { close(): void };

export function startGoogleDataSync({
	database = getDatabase(),
	request = googleApiRequest,
	intervalMs = GOOGLE_DATA_SYNC_INTERVAL_MS,
	syncOptions
}: Partial<GoogleDataSyncDependencies> = {}): GoogleDataSync {
	if (!listAccounts(database).some((account) => account.enabled && account.refreshToken)) return { close() {} };
	let running = false;
	const run = async () => {
		if (running) return;
		running = true;
		try {
			await syncGoogleData({ database, request, syncOptions });
		} catch (error) {
			console.error('Google data sync run failed.', error);
		} finally {
			running = false;
		}
	};
	void run();
	const timer = setInterval(() => void run(), intervalMs);
	return { close: () => clearInterval(timer) };
}
