import type { DatabaseSync } from 'node:sqlite';
import type { EmailClassifier } from './classifier';
import { markDeleted, saveClassification, saveClassificationError, upsertEmails } from './db';
import type { GmailWatchPayload } from './types';

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
