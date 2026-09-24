import type { DatabaseSync } from 'node:sqlite';
import { changeEmailLabels, getThreadActionTargets, markDeleted, markUndeleted } from './db';
import { googleApiRequest, type GoogleAccount } from './google-api';

/** `unarchive` and `undelete` reverse `archive` and `delete`, for Undo. */
export type GmailMessageAction =
  | 'archive'
  | 'delete'
  | 'unarchive'
  | 'undelete'
  | 'markRead'
  | 'star'
  | 'unstar'
  | 'markImportant'
  | 'unmarkImportant';

export const labelChanges = {
  archive: { removeLabelIds: ['INBOX'] },
  unarchive: { addLabelIds: ['INBOX'] },
  markRead: { removeLabelIds: ['UNREAD'] },
  star: { addLabelIds: ['STARRED'] },
  unstar: { removeLabelIds: ['STARRED'] },
  markImportant: { addLabelIds: ['IMPORTANT'] },
  unmarkImportant: { removeLabelIds: ['IMPORTANT'] },
};

export async function runGmailMessageAction(
  account: GoogleAccount,
  gmailId: string,
  action: GmailMessageAction,
  request: typeof googleApiRequest = googleApiRequest
): Promise<void> {
  const messageUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(gmailId)}`;
  if (action === 'delete' || action === 'undelete') {
    await request(account, `${messageUrl}/${action === 'delete' ? 'trash' : 'untrash'}`, {
      method: 'POST',
      data: undefined,
    });
    return;
  }
  await request(account, `${messageUrl}/modify`, { method: 'POST', data: labelChanges[action] });
}

export async function applyGmailMessageAction(
  database: DatabaseSync,
  account: GoogleAccount,
  gmailId: string,
  action: GmailMessageAction,
  request: typeof googleApiRequest = googleApiRequest
): Promise<void> {
  await runGmailMessageAction(account, gmailId, action, request);
  if (action === 'delete') markDeleted(database, account.email, [gmailId]);
  else if (action === 'undelete') markUndeleted(database, account.email, [gmailId]);
  else changeEmailLabels(database, account.email, [gmailId], labelChanges[action]);
}

export async function applyGmailThreadAction(
  database: DatabaseSync,
  account: GoogleAccount,
  localMessageId: number,
  action: GmailMessageAction,
  succeededIds?: number[],
  request: typeof googleApiRequest = googleApiRequest
): Promise<{ succeededIds: number[]; total: number; error: string | null }> {
  const targets = getThreadActionTargets(database, localMessageId, action, succeededIds);
  const completed: number[] = [];
  for (const target of targets) {
    if (target.accountEmail !== account.email) continue;
    try {
      await applyGmailMessageAction(database, account, target.gmailId, action, request);
      completed.push(target.id);
    } catch (error) {
      return {
        succeededIds: completed,
        total: targets.length,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { succeededIds: completed, total: targets.length, error: null };
}
