import type { DatabaseSync } from 'node:sqlite';
import { markArchived, markDeleted } from './db';
import { googleApiRequest, type GoogleAccount } from './google-api';

export type GmailMessageAction = 'archive' | 'delete';

export async function runGmailMessageAction(
  account: GoogleAccount,
  gmailId: string,
  action: GmailMessageAction,
  request: typeof googleApiRequest = googleApiRequest
): Promise<void> {
  const messageUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(gmailId)}`;
  await request(account, action === 'archive' ? `${messageUrl}/modify` : `${messageUrl}/trash`, {
    method: 'POST',
    data: action === 'archive' ? { removeLabelIds: ['INBOX'] } : undefined,
  });
}

export async function applyGmailMessageAction(
  database: DatabaseSync,
  account: GoogleAccount,
  gmailId: string,
  action: GmailMessageAction,
  request: typeof googleApiRequest = googleApiRequest
): Promise<void> {
  await runGmailMessageAction(account, gmailId, action, request);
  if (action === 'archive') markArchived(database, account.email, [gmailId]);
  else markDeleted(database, account.email, [gmailId]);
}
