import type { DatabaseSync } from 'node:sqlite';
import type { EmailClassifier } from './classifier';
import {
  listEmailsNeedingExtraction,
  listAccounts,
  markDeleted,
  saveClassificationError,
  saveEmailExtraction,
  saveEmailExtractionError,
  upsertEmails,
} from './db';
import type { EmailExtractor } from './extractor';
import { saveGmailClassification } from './gmail-classification';
import { googleApiRequest } from './google-api';
import type { GmailWatchPayload } from './types';

export async function ingestGmailPayload(
  database: DatabaseSync,
  payload: GmailWatchPayload,
  classify: EmailClassifier,
  extract: EmailExtractor | null = null,
  request: typeof googleApiRequest = googleApiRequest
): Promise<{ stored: number; classified: number; extracted: number; deleted: number }> {
  markDeleted(database, payload.account, payload.deletedMessageIds);
  const messages = payload.messages.filter((email) => !email.labels?.includes('DRAFT'));
  const pending = upsertEmails(database, payload.account, messages);
  const account = listAccounts(database).find((item) => item.email === payload.account)!;
  let failures = 0;
  for (const email of pending) {
    try {
      const classification = await classify(email, payload.account);
      await saveGmailClassification(database, account, email.id, classification, request);
    } catch (error) {
      failures += 1;
      saveClassificationError(database, payload.account, email.id, error);
    }
  }
  let extracted = 0;
  if (extract) {
    for (const pendingExtraction of listEmailsNeedingExtraction(database, payload.account)) {
      try {
        const extraction = await extract(
          pendingExtraction.email,
          pendingExtraction.targets,
          payload.account
        );
        saveEmailExtraction(database, payload.account, pendingExtraction.email.id, extraction);
        extracted += 1;
      } catch (error) {
        saveEmailExtractionError(database, payload.account, pendingExtraction.email.id, error);
      }
    }
  }
  if (failures > 0) throw new Error(`Jev classification failed for ${failures} message(s).`);
  return {
    stored: messages.length,
    classified: pending.length,
    extracted,
    deleted: payload.deletedMessageIds.length,
  };
}
