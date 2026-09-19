import type { DatabaseSync } from 'node:sqlite';
import { getDatabase, listAccounts, setAccountHistoryId } from './db';
import { runGogJson } from './gog';

export const GMAIL_WATCH_RENEWAL_INTERVAL_MS = 24 * 60 * 60 * 1000;

type GmailWatchRenewalDependencies = {
	database: DatabaseSync;
	runJson?: typeof runGogJson;
	intervalMs?: number;
};

function parseWatchRenewalHistoryId(value: unknown): string {
	if (!value || typeof value !== 'object') {
		throw new Error('gog watch renew returned an invalid result.');
	}
	const result = value as Record<string, unknown>;
	const watch = result.watch;
	const historyId =
		watch && typeof watch === 'object'
			? (watch as Record<string, unknown>).historyId
			: result.historyId;
	if (typeof historyId !== 'string' || !/^\d+$/.test(historyId)) {
		throw new Error('gog watch renew did not return a valid historyId.');
	}
	return historyId;
}

async function renewAccountWatch(
	account: ReturnType<typeof listAccounts>[number],
	runJson: typeof runGogJson
): Promise<string> {
	if (!account.topic) throw new Error(`No Pub/Sub topic is configured for ${account.email}.`);
	const result = await runJson([
		'gog',
		'gmail',
		'watch',
		'renew',
		'--account',
		account.email,
		'--client',
		account.client,
		'--json',
		'--no-input'
	]);
	return parseWatchRenewalHistoryId(result);
}

export async function renewGmailWatches(
	database: DatabaseSync,
	runJson: typeof runGogJson = runGogJson
): Promise<void> {
	const accounts = listAccounts(database).filter((account) => account.enabled && account.topic);
	await Promise.all(
		accounts.map(async (account) => {
			try {
				const historyId = await renewAccountWatch(account, runJson);
				if (!account.historyId) setAccountHistoryId(database, account.email, historyId);
				console.log(`Renewed Gmail watch for ${account.email}.`);
			} catch (error) {
				console.error(`Gmail watch renewal failed for ${account.email}.`, error);
			}
		})
	);
}

export type GmailWatchRenewal = {
	close(): void;
};

export function startGmailWatchRenewal(
	{
		database = getDatabase(),
		runJson = runGogJson,
		intervalMs = GMAIL_WATCH_RENEWAL_INTERVAL_MS
	}: Partial<GmailWatchRenewalDependencies> = {}
): GmailWatchRenewal {
	const renew = () => {
		void renewGmailWatches(database, runJson);
	};

	const timer = setInterval(renew, intervalMs);
	return {
		close() {
			clearInterval(timer);
		}
	};
}
