import { fail, type RequestEvent } from '@sveltejs/kit';
import { applyGmailThreadAction } from '$lib/server/gmail-actions';
import { cancelSnooze, snoozeThread, snoozeWorker } from '$lib/server/snooze';
import {
  getDatabase,
  getEmail,
  getThreadActionTargets,
  listAccounts,
  saveRemoteImageRule,
} from '$lib/server/db';
import { senderAddress, senderDomain } from '$lib/remote-images';
import type { GmailMessageAction } from '$lib/server/gmail-actions';
import type { Actions } from './$types';

// The messages that an Undo reverses. Null when the field is missing or invalid.
function undoIds(fields: FormData): number[] | null {
  try {
    const parsed: unknown = JSON.parse(String(fields.get('succeededIds') ?? 'null'));
    return Array.isArray(parsed) && parsed.every((item) => Number.isInteger(item) && item > 0)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function messageAccount(database: ReturnType<typeof getDatabase>, emailId: number) {
  const email = getEmail(database, emailId);
  return email && listAccounts(database).find((item) => item.email === email.accountEmail);
}

async function changeMessage({ request }: RequestEvent, action: GmailMessageAction) {
  const fields = await request.formData();
  const emailId = Number(fields.get('id'));
  if (!Number.isInteger(emailId) || emailId <= 0)
    return fail(400, { error: 'The message ID is invalid.' });

  const database = getDatabase();
  let succeededIds: number[] | undefined;
  if (action === 'unarchive' || action === 'undelete') {
    succeededIds = undoIds(fields) ?? undefined;
    if (!succeededIds)
      return fail(400, { error: 'Undo requires the messages changed by the original action.' });
  }
  const targets = getThreadActionTargets(database, emailId, action, succeededIds);
  if (!targets.length) return fail(404, { error: 'The thread is no longer available.' });
  const account = listAccounts(database).find((item) => item.email === targets[0].accountEmail);
  if (!account) return fail(404, { error: 'The email account is no longer available.' });

  try {
    const result = await applyGmailThreadAction(database, account, emailId, action, succeededIds);
    if (result.error && result.succeededIds.length === 0) return fail(502, { error: result.error });
    const messages: Record<GmailMessageAction, string> = {
      archive: 'Message archived.',
      delete: 'Message moved to Gmail Trash.',
      unarchive: 'Message moved back to the inbox.',
      undelete: 'Message restored from Gmail Trash.',
      markRead: 'Message marked as read.',
      star: 'Thread starred.',
      unstar: 'Thread unstarred.',
    };
    return {
      message: result.error
        ? `${result.succeededIds.length} of ${result.total} messages changed.`
        : messages[action],
      succeededIds: result.succeededIds,
      error: result.error,
    };
  } catch (error) {
    return fail(502, { error: error instanceof Error ? error.message : String(error) });
  }
}

export const actions: Actions = {
  archive: (event) => changeMessage(event, 'archive'),
  delete: (event) => changeMessage(event, 'delete'),
  unarchive: (event) => changeMessage(event, 'unarchive'),
  undelete: (event) => changeMessage(event, 'undelete'),
  markRead: (event) => changeMessage(event, 'markRead'),
  star: (event) => changeMessage(event, 'star'),
  unstar: (event) => changeMessage(event, 'unstar'),
  snooze: async ({ request }) => {
    const fields = await request.formData();
    const emailId = Number(fields.get('id'));
    const until = Date.parse(String(fields.get('until') ?? ''));
    if (!Number.isInteger(emailId) || emailId <= 0)
      return fail(400, { error: 'The message ID is invalid.' });
    if (!Number.isFinite(until) || until <= Date.now())
      return fail(400, { error: 'Choose a snooze time in the future.' });
    const database = getDatabase();
    const account = messageAccount(database, emailId);
    if (!account) return fail(404, { error: 'The thread is no longer available.' });
    try {
      const result = await snoozeThread(database, account, emailId, until);
      if (result.total === 0) return fail(409, { error: 'The thread is not in the inbox.' });
      if (result.error && result.succeededIds.length === 0)
        return fail(502, { error: result.error });
      snoozeWorker().wake();
      return {
        message: result.error
          ? `${result.succeededIds.length} of ${result.total} messages snoozed.`
          : 'Thread snoozed.',
        succeededIds: result.succeededIds,
        error: result.error,
      };
    } catch (error) {
      return fail(502, { error: error instanceof Error ? error.message : String(error) });
    }
  },
  unsnooze: async ({ request }) => {
    const fields = await request.formData();
    const emailId = Number(fields.get('id'));
    const succeededIds = undoIds(fields);
    if (!Number.isInteger(emailId) || emailId <= 0 || !succeededIds)
      return fail(400, { error: 'Undo requires the messages changed by the snooze.' });
    const database = getDatabase();
    const account = messageAccount(database, emailId);
    if (!account) return fail(404, { error: 'The thread is no longer available.' });
    try {
      const result = await cancelSnooze(database, account, emailId, succeededIds);
      if (result.error) return fail(502, { error: result.error });
      return { message: 'Message moved back to the inbox.' };
    } catch (error) {
      return fail(502, { error: error instanceof Error ? error.message : String(error) });
    }
  },
  saveRemoteImageRule: async ({ request }) => {
    const fields = await request.formData();
    const id = Number(fields.get('id'));
    const kind = fields.get('kind');
    if (!Number.isInteger(id) || id <= 0 || (kind !== 'address' && kind !== 'domain')) {
      return fail(400, { error: 'The image setting is invalid.' });
    }
    const database = getDatabase();
    const email = getEmail(database, id);
    if (!email) return fail(404, { error: 'The message is no longer available.' });
    const value =
      kind === 'address' ? senderAddress(email.fromAddress) : senderDomain(email.fromAddress);
    if (!value) return fail(400, { error: 'This message has no valid sender address.' });
    saveRemoteImageRule(database, { kind, value });
    return { message: `Remote images will load from ${value}.` };
  },
};
