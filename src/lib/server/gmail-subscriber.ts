import { PubSub, type Message, type Subscription } from '@google-cloud/pubsub';
import type { DatabaseSync } from 'node:sqlite';
import { createJevClassifier, type EmailClassifier } from './classifier';
import { getDatabase, listAccounts, setAccountHistoryId } from './db';
import { GogCommandError, normalizeGetMessage, runGogJson } from './gog';
import { ingestGmailPayload } from './ingest';
import type { IncomingEmail } from './types';

export type GmailSubscriberAccount = {
	email: string;
	client: string;
	subscription: string;
	historyId: string | null;
};

export type GmailNotification = {
	emailAddress: string;
	historyId: string;
};

type HistoryResult = {
	historyId: string;
	messages: string[];
};

type SubscriberDependencies = {
	database: DatabaseSync;
	classify: EmailClassifier;
	runJson?: typeof runGogJson;
};

export function groupAccountsBySubscription(
	accounts: GmailSubscriberAccount[]
): Map<string, Map<string, GmailSubscriberAccount>> {
	const groups = new Map<string, Map<string, GmailSubscriberAccount>>();
	for (const account of accounts) {
		let group = groups.get(account.subscription);
		if (!group) {
			group = new Map();
			groups.set(account.subscription, group);
		}
		group.set(account.email.toLowerCase(), account);
	}
	return groups;
}

export function parseGmailNotification(data: Uint8Array): GmailNotification {
	const value = JSON.parse(Buffer.from(data).toString('utf8')) as Record<string, unknown>;
	if (typeof value.emailAddress !== 'string' || value.emailAddress.length === 0) {
		throw new Error('The Gmail notification does not include an emailAddress.');
	}
	const historyId =
		typeof value.historyId === 'string'
			? value.historyId
			: typeof value.historyId === 'number' && Number.isSafeInteger(value.historyId)
				? String(value.historyId)
				: null;
	if (historyId === null || !/^\d+$/.test(historyId)) {
		throw new Error('The Gmail notification does not include a valid historyId.');
	}
	return { emailAddress: value.emailAddress, historyId };
}

function isNewerHistoryId(candidate: string, current: string): boolean {
	return BigInt(candidate) > BigInt(current);
}

function parseHistoryResult(value: unknown): HistoryResult {
	if (!value || typeof value !== 'object') throw new Error('gog returned invalid Gmail history.');
	const result = value as Record<string, unknown>;
	if (typeof result.historyId !== 'string' || !/^\d+$/.test(result.historyId)) {
		throw new Error('gog Gmail history did not include a valid historyId.');
	}
	return {
		historyId: result.historyId,
		messages: Array.isArray(result.messages)
			? result.messages.filter((id): id is string => typeof id === 'string' && id.length > 0)
			: []
	};
}

function parseWatchHistoryId(value: unknown): string {
	if (!value || typeof value !== 'object') throw new Error('gog returned invalid watch status.');
	const watch = (value as Record<string, unknown>).watch;
	if (!watch || typeof watch !== 'object') throw new Error('gog watch status is not configured.');
	const historyId = (watch as Record<string, unknown>).historyId;
	if (typeof historyId !== 'string' || !/^\d+$/.test(historyId)) {
		throw new Error('gog watch status did not include a valid historyId.');
	}
	return historyId;
}

async function loadInitialHistoryId(
	account: GmailSubscriberAccount,
	database: DatabaseSync,
	runJson: typeof runGogJson
): Promise<string> {
	if (account.historyId) return account.historyId;
	const result = await runJson([
		'gog',
		'gmail',
		'watch',
		'status',
		'--account',
		account.email,
		'--client',
		account.client,
		'--json',
		'--no-input'
	]);
	const historyId = parseWatchHistoryId(result);
	setAccountHistoryId(database, account.email, historyId);
	account.historyId = historyId;
	return historyId;
}

async function fetchMessage(
	account: GmailSubscriberAccount,
	messageId: string,
	runJson: typeof runGogJson
): Promise<IncomingEmail | null> {
	try {
		return normalizeGetMessage(
			await runJson([
				'gog',
				'gmail',
				'get',
				messageId,
				'--account',
				account.email,
				'--client',
				account.client,
				'--json',
				'--no-input',
				'--readonly'
			])
		);
	} catch (error) {
		if (error instanceof GogCommandError && error.exitCode === 5) return null;
		throw error;
	}
}

export async function processGmailNotification(
	account: GmailSubscriberAccount,
	notification: GmailNotification,
	dependencies: SubscriberDependencies
): Promise<{ stored: number; classified: number; deleted: number }> {
	const runJson = dependencies.runJson ?? runGogJson;
	const currentHistoryId = await loadInitialHistoryId(account, dependencies.database, runJson);
	if (!isNewerHistoryId(notification.historyId, currentHistoryId)) {
		return { stored: 0, classified: 0, deleted: 0 };
	}

	const history = parseHistoryResult(
		await runJson([
			'gog',
			'gmail',
			'history',
			'--since',
			currentHistoryId,
			'--account',
			account.email,
			'--client',
			account.client,
			'--json',
			'--all',
			'--no-input',
			'--readonly'
		])
	);

	const messages: IncomingEmail[] = [];
	const deletedMessageIds: string[] = [];
	for (const messageId of [...new Set(history.messages)]) {
		const message = await fetchMessage(account, messageId, runJson);
		if (!message) {
			deletedMessageIds.push(messageId);
		} else if (message.labels?.includes('INBOX')) {
			messages.push(message);
		}
	}

	const result = await ingestGmailPayload(
		dependencies.database,
		{
			source: 'gmail',
			account: account.email,
			historyId: history.historyId,
			deletedMessageIds,
			messages
		},
		dependencies.classify
	);
	setAccountHistoryId(dependencies.database, account.email, history.historyId);
	account.historyId = history.historyId;
	return result;
}

export type GmailSubscribers = {
	subscriptions: Subscription[];
	close(): Promise<void>;
};

export function startGmailSubscribers(): GmailSubscribers | null {
	const database = getDatabase();
	const accounts = listAccounts(database)
		.filter(
			(account): account is typeof account & { subscription: string } =>
				account.enabled && Boolean(account.subscription)
		)
		.map((account) => ({
			email: account.email,
			client: account.client,
			subscription: account.subscription,
			historyId: account.historyId
		}));
	if (accounts.length === 0) {
		console.log('No Pub/Sub subscriptions are configured. The app will run without subscribers.');
		return null;
	}

	const pubsub = new PubSub();
	const subscriptions: Subscription[] = [];
	const queues = new Map<string, Promise<void>>();
	for (const [subscriptionName, accountsByEmail] of groupAccountsBySubscription(accounts)) {
		const subscription = pubsub.subscription(subscriptionName);
		subscriptions.push(subscription);
		console.log(
			`Starting Pub/Sub subscriber ${subscriptionName} for ${accountsByEmail.size} Gmail account(s).`
		);

		subscription.on('message', (message: Message) => {
			let notification: GmailNotification;
			try {
				notification = parseGmailNotification(message.data);
			} catch (error) {
				console.error('Acknowledging invalid Gmail Pub/Sub message.', {
					message: message.data.toString('utf8'),
					error
				});
				message.ack();
				return;
			}

			const account = accountsByEmail.get(notification.emailAddress.toLowerCase());
			if (!account) {
				console.error(
					`Acknowledging Gmail notification for unconfigured account ${notification.emailAddress} on ${subscriptionName}.`
				);
				message.ack();
				return;
			}

			const previous = queues.get(account.email) ?? Promise.resolve();
			const current = previous
				.catch(() => undefined)
				.then(async () => {
					try {
						await processGmailNotification(account, notification, {
							database,
							classify: createJevClassifier()
						});
						message.ack();
					} catch (error) {
						console.error(`Gmail notification failed for ${account.email}.`, error);
						message.nack();
					}
				});
			queues.set(account.email, current);
			void current.finally(() => {
				if (queues.get(account.email) === current) queues.delete(account.email);
			});
		});
		subscription.on('error', (error) => {
			console.error(`Pub/Sub subscriber failed for ${subscriptionName}.`, error);
		});
	}

	return {
		subscriptions,
		async close() {
			await Promise.all(subscriptions.map((subscription) => subscription.close()));
			await pubsub.close();
		}
	};
}
