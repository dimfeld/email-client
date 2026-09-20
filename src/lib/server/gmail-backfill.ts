import type { DatabaseSync } from 'node:sqlite';
import { createJevClassifier, type EmailClassifier } from './classifier';
import { getDatabase, listAccounts, setAccountLastBackfillAt } from './db';
import { normalizeSearchMessage, runGogJson } from './gog';
import { ingestGmailPayload } from './ingest';

export const GMAIL_BACKFILL_INTERVAL_MS = 5 * 60 * 1000;
export const GMAIL_BACKFILL_OVERLAP_MS = 5 * 60 * 1000;
export const GMAIL_BACKFILL_INITIAL_LOOKBACK_MS = 60 * 60 * 1000;

type GmailBackfillDependencies = {
	database: DatabaseSync;
	classify: EmailClassifier;
	runJson?: typeof runGogJson;
	now?: () => Date;
	intervalMs?: number;
};

export type GmailBackfillResult = {
	accounts: number;
	succeeded: number;
	failed: number;
	stored: number;
	classified: number;
};

export function isGmailRateLimitError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /(?:\b429\b|rate[\s_-]*limit|too many requests|quota(?:[\s_-]*exceeded)?|resource[\s_-]*exhausted|userRateLimitExceeded)/i.test(
		message
	);
}

export function buildGmailBackfillQuery(lastBackfillAt: string | null, now: Date): string {
	const recordedAt = lastBackfillAt === null ? Number.NaN : Date.parse(lastBackfillAt);
	const startAt = Number.isFinite(recordedAt)
		? recordedAt - GMAIL_BACKFILL_OVERLAP_MS
		: now.getTime() - GMAIL_BACKFILL_INITIAL_LOOKBACK_MS;
	return `in:inbox after:${Math.max(0, Math.floor(startAt / 1000))}`;
}

function parseSearchResult(value: unknown): unknown[] {
	if (!value || typeof value !== 'object') throw new Error('gog returned invalid Gmail search results.');
	const messages = (value as Record<string, unknown>).messages;
	if (messages === undefined) return [];
	if (!Array.isArray(messages)) throw new Error('gog Gmail search results did not include a message list.');
	return messages;
}

async function backfillAccount(
	account: ReturnType<typeof listAccounts>[number],
	dependencies: GmailBackfillDependencies,
	now: Date
): Promise<{ stored: number; classified: number }> {
	const runJson = dependencies.runJson ?? runGogJson;
	const query = buildGmailBackfillQuery(account.lastBackfillAt, now);
	const command = [
		'gog',
		'gmail',
		'messages',
		'search',
		query,
		'--account',
		account.email,
		'--client',
		account.client,
		'--json',
		'--all',
		'--include-body',
		'--full',
		'--no-input',
		'--readonly'
	];
	const [textResult, htmlResult] = await Promise.all([
		runJson([...command, '--body-format', 'text']),
		runJson([...command, '--body-format', 'html'])
	]);
	const htmlById = new Map(
		parseSearchResult(htmlResult)
			.map((value) => normalizeSearchMessage(value, 'html'))
			.map((message) => [message.id, message.bodyHtml] as const)
	);
	const messages = parseSearchResult(textResult).map((value) => {
		const message = normalizeSearchMessage(value, 'text');
		return { ...message, bodyHtml: htmlById.get(message.id) };
	});
	const ingested = await ingestGmailPayload(
		dependencies.database,
		{
			source: 'gmail',
			account: account.email,
			deletedMessageIds: [],
			messages
		},
		dependencies.classify
	);
	setAccountLastBackfillAt(dependencies.database, account.email, now.toISOString());
	return { stored: ingested.stored, classified: ingested.classified };
}

export async function backfillGmail(
	dependencies: GmailBackfillDependencies
): Promise<GmailBackfillResult> {
	const now = (dependencies.now ?? (() => new Date()))();
	const accounts = listAccounts(dependencies.database).filter((account) => account.enabled);
	const results = await Promise.all(
		accounts.map(async (account) => {
			try {
				const result = await backfillAccount(account, dependencies, now);
				console.log(
					`Completed Gmail backfill for ${account.email}: ${result.stored} new message${result.stored === 1 ? '' : 's'} pulled in.`
				);
				return { ok: true, ...result };
			} catch (error) {
				if (isGmailRateLimitError(error)) {
					console.warn(`Gmail backfill deferred for ${account.email}.`, error);
				} else {
					console.error(`Gmail backfill failed for ${account.email}.`, error);
				}
				return { ok: false, stored: 0, classified: 0 };
			}
		})
	);
	return {
		accounts: accounts.length,
		succeeded: results.filter((result) => result.ok).length,
		failed: results.filter((result) => !result.ok).length,
		stored: results.reduce((total, result) => total + result.stored, 0),
		classified: results.reduce((total, result) => total + result.classified, 0)
	};
}

export type GmailBackfill = {
	close(): void;
};

export function startGmailBackfill(
	{
		database,
		runJson = runGogJson,
		classify,
		intervalMs = GMAIL_BACKFILL_INTERVAL_MS
	}: Partial<GmailBackfillDependencies> & { database?: DatabaseSync } = {}
): GmailBackfill {
	const activeDatabase = database ?? getDatabase();
	if (!listAccounts(activeDatabase).some((account) => account.enabled)) {
		console.log('No enabled Gmail accounts are configured. The app will run without backfill.');
		return { close() {} };
	}
	let running = false;
	const run = async () => {
		if (running) return;
		running = true;
		try {
			await backfillGmail({
				database: activeDatabase,
				runJson,
				classify: classify ?? createJevClassifier()
			});
		} catch (error) {
			console.error('Gmail backfill run failed.', error);
		} finally {
			running = false;
		}
	};

	void run();
	const timer = setInterval(() => void run(), intervalMs);
	return {
		close() {
			clearInterval(timer);
		}
	};
}
