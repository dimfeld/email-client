import type { DatabaseSync } from 'node:sqlite';
import { effectiveImportance } from '$lib/categories';
import { changeEmailLabels, getIncomingEmail, listCategories, saveClassification } from './db';
import { googleApiRequest, type GoogleAccount } from './google-api';
import type { Classification } from './types';

export async function saveGmailClassification(
  database: DatabaseSync,
  account: GoogleAccount,
  gmailId: string,
  classification: Classification,
  request: typeof googleApiRequest = googleApiRequest
): Promise<void> {
  const category = listCategories(database).find((item) => item.id === classification.category);
  if (!category)
    throw new Error('The selected category no longer exists. Classify this message again.');

  if (
    account.refreshToken &&
    effectiveImportance(category.level, classification.importance) === 'important' &&
    !getIncomingEmail(database, account.email, gmailId)?.labels?.includes('STARRED')
  ) {
    await request(
      account,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(gmailId)}/modify`,
      { method: 'POST', data: { addLabelIds: ['STARRED'] } }
    );
    changeEmailLabels(database, account.email, [gmailId], { addLabelIds: ['STARRED'] });
  }

  saveClassification(database, account.email, gmailId, classification);
}
