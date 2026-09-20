import type { DatabaseSync } from 'node:sqlite';
import type { EmailClassifier } from './classifier';
import {
	listEmailsNeedingExtraction,
	markDeleted,
	saveClassification,
	saveClassificationError,
	saveEmailExtraction,
	saveEmailExtractionError,
	upsertEmails
} from './db';
import type { EmailExtractor } from './extractor';
import type { GmailWatchPayload } from './types';

export async function ingestGmailPayload(
	database: DatabaseSync,
	payload: GmailWatchPayload,
	classify: EmailClassifier,
	extract: EmailExtractor | null = null
): Promise<{ stored: number; classified: number; extracted: number; deleted: number }> {
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
	let extracted = 0;
	if (extract) {
		for (const pendingExtraction of listEmailsNeedingExtraction(database, payload.account)) {
			try {
				const extraction = await extract(pendingExtraction.email, pendingExtraction.targets);
				saveEmailExtraction(database, payload.account, pendingExtraction.email.id, extraction);
				extracted += 1;
			} catch (error) {
				saveEmailExtractionError(database, payload.account, pendingExtraction.email.id, error);
			}
		}
	}
	if (failures > 0) throw new Error(`Jev classification failed for ${failures} message(s).`);
	return {
		stored: payload.messages.length,
		classified: pending.length,
		extracted,
		deleted: payload.deletedMessageIds.length
	};
}
