import type { DatabaseSync } from 'node:sqlite';
import { markArchived, markDeleted, markUnarchived, markUndeleted } from './db';
import { googleApiRequest, type GoogleAccount } from './google-api';

/** `unarchive` and `undelete` reverse `archive` and `delete`, for Undo. */
export type GmailMessageAction = 'archive' | 'delete' | 'unarchive' | 'undelete';

export async function runGmailMessageAction(
  account: GoogleAccount,
  gmailId: string,
  action: GmailMessageAction,
  request: typeof googleApiRequest = googleApiRequest
): Promise<void> {
  const messageUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(gmailId)}`;
  if (action === 'archive' || action === 'unarchive') {
    await request(account, `${messageUrl}/modify`, {
      method: 'POST',
      data: action === 'archive' ? { removeLabelIds: ['INBOX'] } : { addLabelIds: ['INBOX'] },
    });
    return;
  }
  await request(account, `${messageUrl}/${action === 'delete' ? 'trash' : 'untrash'}`, {
    method: 'POST',
    data: undefined,
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
  const mark = {
    archive: markArchived,
    delete: markDeleted,
    unarchive: markUnarchived,
    undelete: markUndeleted,
  }[action];
  mark(database, account.email, [gmailId]);
}
