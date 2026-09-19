import type { DatabaseSync } from 'node:sqlite';
import type { EmailClassifier } from './classifier';
import { markDeleted, saveClassification, saveClassificationError, upsertEmails } from './db';
import type { GmailWatchPayload, IncomingEmail } from './types';

export class GmailPayloadError extends Error {}

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function parseMessage(value: unknown): IncomingEmail {
	if (!value || typeof value !== 'object') {
		throw new GmailPayloadError('Each Gmail message must be an object.');
	}
	const message = value as Record<string, unknown>;
	if (typeof message.id !== 'string' || message.id.length === 0) {
		throw new GmailPayloadError('Each Gmail message needs an id.');
	}
	return {
		id: message.id,
		threadId: optionalString(message.threadId ?? message.thread_id),
		from: optionalString(message.from ?? message.fromAddress),
		to: optionalString(message.to ?? message.toAddress),
		subject: optionalString(message.subject),
		date: optionalString(message.date ?? message.internalDate),
		snippet: optionalString(message.snippet),
		body: optionalString(message.body ?? message.textBody ?? message.bodyText),
		bodyTruncated: Boolean(message.bodyTruncated ?? message.body_truncated),
		labels: Array.isArray(message.labels ?? message.labelIds)
			? ((message.labels ?? message.labelIds) as unknown[]).filter(
					(label): label is string => typeof label === 'string'
				)
			: []
	};
}

export function parseGmailPayload(value: unknown): GmailWatchPayload {
	if (!value || typeof value !== 'object') {
		throw new GmailPayloadError('The Gmail payload must be an object.');
	}
	const payload = value as Record<string, unknown>;
	if (payload.source !== undefined && payload.source !== 'gmail') {
		throw new GmailPayloadError('The webhook source must be gmail.');
	}
	if (typeof payload.account !== 'string' || payload.account.length === 0) {
		throw new GmailPayloadError('The Gmail payload needs an account.');
	}
	return {
		source: 'gmail',
		account: payload.account,
		historyId: optionalString(payload.historyId ?? payload.history_id),
		deletedMessageIds: Array.isArray(payload.deletedMessageIds ?? payload.deleted_message_ids)
			? ((payload.deletedMessageIds ?? payload.deleted_message_ids) as unknown[]).filter(
					(id): id is string => typeof id === 'string'
				)
			: [],
		messages: Array.isArray(payload.messages) ? payload.messages.map(parseMessage) : []
	};
}

export async function ingestGmailPayload(
	database: DatabaseSync,
	payload: GmailWatchPayload,
	classify: EmailClassifier
): Promise<{ stored: number; classified: number; deleted: number }> {
	markDeleted(database, payload.account, payload.deletedMessageIds);
	const pending = upsertEmails(database, payload.account, payload.messages);
	let failures = 0;
	for (const email of pending) {
		try {
			const classification = await classify(email);
			saveClassification(database, payload.account, email.id, classification);
		} catch (error) {
			failures += 1;
			saveClassificationError(database, payload.account, email.id, error);
		}
	}
	if (failures > 0) throw new Error(`Jev classification failed for ${failures} message(s).`);
	return {
		stored: payload.messages.length,
		classified: pending.length,
		deleted: payload.deletedMessageIds.length
	};
}
