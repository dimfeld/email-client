import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { createTransport } from 'nodemailer';
import addressparser from 'nodemailer/lib/addressparser';
import sanitizeHtml from 'sanitize-html';
import type { ComposeMode, Draft, DraftInput } from '$lib/composer';
import { getEmail, listAccounts, markArchived, upsertEmails } from './db';
import { googleApiRequest, normalizeGmailMessage, type GoogleAccount } from './google-api';
import { publishStateChange } from './state-events';

// Gmail Discovery API: users.messages.send mediaUpload.maxSize.
export const GMAIL_MAX_MESSAGE_BYTES = 36_700_160;
export class DraftError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}
const editable = ['draft', 'failed'];
const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
export function cleanComposeHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'div',
      'span',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'del',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'code',
      'hr',
      'a',
      'img',
      'table',
      'tbody',
      'thead',
      'tr',
      'td',
      'th',
    ],
    allowedAttributes: {
      a: ['href', 'title'],
      img: ['src', 'alt', 'width', 'height'],
      '*': ['style'],
      ol: ['start'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'cid'],
    allowedSchemesByTag: { img: ['https', 'http', 'data', 'cid'] },
    allowedStyles: {
      '*': {
        'text-align': [/^(left|right|center|justify)$/],
        color: [/^#[a-f0-9]+$/i],
        'background-color': [/^#[a-f0-9]+$/i],
      },
    },
    allowProtocolRelative: false,
  });
}
export function parseRecipients(value: string): { address: string; name: string }[] {
  if (/[\r\n]/.test(value)) throw new DraftError('Recipient fields must not contain line breaks.');
  const addresses = addressparser(value, { flatten: true });
  if (value.trim() && addresses.length === 0) throw new DraftError('Enter a valid email address.');
  for (const item of addresses)
    if (!item.address || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(item.address))
      throw new DraftError(`Check this email address: ${item.address || item.name}`);
  return addresses as { address: string; name: string }[];
}
function formatAddresses(addresses: { address: string; name: string }[]): string {
  return addresses
    .map((item) =>
      item.name ? `"${item.name.replaceAll('"', '')}" <${item.address}>` : item.address
    )
    .join(', ');
}
function rowToDraft(database: DatabaseSync, row: Record<string, unknown>): Draft {
  const attachments = database
    .prepare(
      'SELECT id, filename, content_type, length(content) AS size FROM draft_attachments WHERE draft_id = ? ORDER BY rowid'
    )
    .all(String(row.id));
  return {
    id: String(row.id),
    accountEmail: String(row.account_email),
    to: String(row.to_addresses),
    cc: String(row.cc_addresses),
    bcc: String(row.bcc_addresses),
    subject: String(row.subject),
    html: String(row.body_html),
    text: String(row.body_text),
    mode: row.mode as ComposeMode,
    sourceEmailId: row.source_email_id === null ? null : Number(row.source_email_id),
    version: Number(row.version),
    status: row.status as Draft['status'],
    sendAt: row.send_at === null ? null : Number(row.send_at),
    error: row.error as string | null,
    messageId: row.message_id as string | null,
    updatedAt: String(row.updated_at),
    attachments: attachments.map((item) => ({
      id: String(item.id),
      filename: String(item.filename),
      contentType: String(item.content_type),
      size: Number(item.size),
    })),
  };
}
export function getDraft(database: DatabaseSync, id: string): Draft {
  const row = database.prepare('SELECT * FROM email_drafts WHERE id = ?').get(id);
  if (!row) throw new DraftError('This draft is no longer available.', 404);
  return rowToDraft(database, row);
}
export function listDrafts(database: DatabaseSync): Draft[] {
  return database
    .prepare("SELECT * FROM email_drafts WHERE status != 'sent' ORDER BY updated_at DESC")
    .all()
    .map((row) => rowToDraft(database, row));
}
function checkEditable(database: DatabaseSync, id: string, version: number): Draft {
  const draft = getDraft(database, id);
  if (!editable.includes(draft.status))
    throw new DraftError('Undo Send before editing this message.', 409);
  if (draft.version !== version)
    throw new DraftError('This draft changed in another window. Reopen it before saving.', 409);
  return draft;
}
export function saveDraft(
  database: DatabaseSync,
  id: string,
  version: number,
  input: DraftInput
): Draft {
  checkEditable(database, id, version);
  if (!listAccounts(database).some((account) => account.email === input.accountEmail))
    throw new DraftError('Choose an available sending account.');
  if (/[\r\n]/.test(input.subject)) throw new DraftError('The subject must fit on one line.');
  database
    .prepare(
      `UPDATE email_drafts SET account_email = ?, to_addresses = ?, cc_addresses = ?, bcc_addresses = ?, subject = ?, body_html = ?, body_text = ?, version = version + 1, status = 'draft', error = NULL, updated_at = ? WHERE id = ?`
    )
    .run(
      input.accountEmail,
      input.to,
      input.cc,
      input.bcc,
      input.subject,
      cleanComposeHtml(input.html),
      input.text,
      new Date().toISOString(),
      id
    );
  publishStateChange();
  return getDraft(database, id);
}

type ForwardPart = {
  filename?: string;
  mimeType?: string;
  body?: { data?: string; attachmentId?: string };
  parts?: ForwardPart[];
};
async function forwardAttachments(
  account: GoogleAccount,
  gmailId: string,
  part: ForwardPart,
  request: typeof googleApiRequest
): Promise<{ filename: string; contentType: string; content: Buffer }[]> {
  const result = [];
  if (part.filename) {
    const body = part.body?.attachmentId
      ? await request<{ data?: string }>(
          account,
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(gmailId)}/attachments/${encodeURIComponent(part.body.attachmentId)}`
        )
      : part.body;
    if (typeof body?.data !== 'string')
      throw new DraftError(`Could not download attachment: ${part.filename}`);
    result.push({
      filename: part.filename,
      contentType: part.mimeType ?? 'application/octet-stream',
      content: Buffer.from(body.data, 'base64url'),
    });
  }
  for (const child of part.parts ?? [])
    result.push(...(await forwardAttachments(account, gmailId, child, request)));
  return result;
}
export async function createDraft(
  database: DatabaseSync,
  input: { mode: ComposeMode; account?: string; sourceEmailId?: number },
  request = googleApiRequest
): Promise<Draft> {
  const accounts = listAccounts(database);
  let source = input.sourceEmailId ? getEmail(database, input.sourceEmailId) : null;
  if (input.mode !== 'new' && !source)
    throw new DraftError('The original message is no longer available.');
  const accountEmail = source?.accountEmail ?? input.account ?? accounts[0]?.email;
  const account = accounts.find((item) => item.email === accountEmail);
  if (!account) throw new DraftError('Connect an account before composing email.');
  let files: Awaited<ReturnType<typeof forwardAttachments>> = [];
  if (source && (!source.headers?.['message-id'] || input.mode === 'forward')) {
    if (!account.refreshToken)
      throw new DraftError(
        'Reconnect this account to load the original message and its reply headers.'
      );
    const remote = await request<{ payload?: ForwardPart }>(
      account,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(source.gmailId)}`,
      { params: { format: 'full' } }
    );
    const normalized = normalizeGmailMessage(remote as Record<string, unknown>);
    upsertEmails(database, account.email, [normalized]);
    source = getEmail(database, source.id)!;
    if (input.mode === 'forward' && remote.payload)
      files = await forwardAttachments(account, source.gmailId, remote.payload, request);
  }
  let to = '';
  let cc = '';
  let subject = '';
  let html = '<p></p>';
  let text = '';
  if (source) {
    const replying = input.mode === 'reply' || input.mode === 'replyAll';
    subject = replying
      ? /^re:/i.test(source.subject)
        ? source.subject
        : `Re: ${source.subject}`
      : /^fwd?:/i.test(source.subject)
        ? source.subject
        : `Fwd: ${source.subject}`;
    if (replying) {
      const own = new Set(accounts.map((item) => item.email.toLowerCase()));
      const target = parseRecipients(source.headers?.['reply-to'] || source.fromAddress);
      const sentBySelf = target.every((item) => own.has(item.address.toLowerCase()));
      const primary = sentBySelf ? parseRecipients(source.toAddresses) : target;
      const seen = new Set<string>();
      const unique = (items: ReturnType<typeof parseRecipients>) =>
        items.filter((item) => {
          const key = item.address.toLowerCase();
          if (own.has(key) || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      to = formatAddresses(unique(primary));
      if (input.mode === 'replyAll')
        cc = formatAddresses(
          unique([
            ...parseRecipients(source.toAddresses),
            ...parseRecipients(source.headers?.cc ?? ''),
          ])
        );
    }
    const quote =
      source.bodyText ||
      sanitizeHtml(source.bodyHtml ?? '', { allowedTags: [], allowedAttributes: {} });
    const heading =
      input.mode === 'forward'
        ? `Forwarded message\nFrom: ${source.fromAddress}\nDate: ${source.messageDate ?? ''}\nSubject: ${source.subject}\nTo: ${source.toAddresses}`
        : `On ${source.messageDate ?? 'an unknown date'}, ${source.fromAddress} wrote:`;
    text = `\n\n${heading}\n${quote}`;
    const quotedHtml = source.bodyHtml
      ? cleanComposeHtml(source.bodyHtml).replace(
          /<img\b[^>]*>/gi,
          '<span>[Image in original message]</span>'
        )
      : escapeHtml(quote).replaceAll('\n', '<br>');
    html = `<p></p><p>${escapeHtml(heading).replaceAll('\n', '<br>')}</p><blockquote>${quotedHtml}</blockquote>`;
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  database.exec('BEGIN IMMEDIATE');
  try {
    database
      .prepare(
        `INSERT INTO email_drafts(id, account_email, to_addresses, cc_addresses, subject, body_html, body_text, mode, source_email_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        account.email,
        to,
        cc,
        subject,
        html,
        text,
        input.mode,
        source?.id ?? null,
        now,
        now
      );
    for (const file of files)
      database
        .prepare('INSERT INTO draft_attachments VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), id, file.filename, file.contentType, file.content);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  publishStateChange();
  return getDraft(database, id);
}
export function addDraftAttachment(
  database: DatabaseSync,
  id: string,
  version: number,
  filename: string,
  contentType: string,
  content: Uint8Array
): Draft {
  checkEditable(database, id, version);
  if (content.byteLength > GMAIL_MAX_MESSAGE_BYTES)
    throw new DraftError('This file exceeds the Gmail message size limit.');
  database.exec('BEGIN IMMEDIATE');
  try {
    database
      .prepare('INSERT INTO draft_attachments VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), id, filename, contentType || 'application/octet-stream', content);
    database
      .prepare('UPDATE email_drafts SET version = version + 1, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  publishStateChange();
  return getDraft(database, id);
}
export function removeDraftAttachment(
  database: DatabaseSync,
  id: string,
  version: number,
  attachmentId: string
): Draft {
  checkEditable(database, id, version);
  database
    .prepare('DELETE FROM draft_attachments WHERE draft_id = ? AND id = ?')
    .run(id, attachmentId);
  database
    .prepare('UPDATE email_drafts SET version = version + 1, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
  publishStateChange();
  return getDraft(database, id);
}
export function discardDraft(database: DatabaseSync, id: string, version: number) {
  checkEditable(database, id, version);
  database.prepare('DELETE FROM email_drafts WHERE id = ?').run(id);
  publishStateChange();
}

export async function buildDraftMime(
  database: DatabaseSync,
  draft: Draft,
  messageId: string
): Promise<Buffer> {
  const to = parseRecipients(draft.to),
    cc = parseRecipients(draft.cc),
    bcc = parseRecipients(draft.bcc);
  if (!to.length && !cc.length && !bcc.length) throw new DraftError('Add at least one recipient.');
  const source = draft.sourceEmailId ? getEmail(database, draft.sourceEmailId) : null;
  const reply = draft.mode === 'reply' || draft.mode === 'replyAll';
  if (reply && !source?.headers?.['message-id'])
    throw new DraftError(
      'The original reply headers are missing. Open a new reply from the original message.'
    );
  const attachments = database
    .prepare('SELECT * FROM draft_attachments WHERE draft_id = ? ORDER BY rowid')
    .all(draft.id);
  const transport = createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
  const info = await transport.sendMail({
    from: draft.accountEmail,
    to,
    cc,
    bcc,
    subject: draft.subject,
    text: draft.text,
    html: cleanComposeHtml(draft.html),
    messageId,
    inReplyTo: reply ? source?.headers?.['message-id'] : undefined,
    references: reply
      ? [source?.headers?.references, source?.headers?.['message-id']].filter(Boolean).join(' ')
      : undefined,
    attachments: attachments.map((file) => ({
      filename: String(file.filename),
      contentType: String(file.content_type),
      content: Buffer.from(file.content as Uint8Array),
    })),
    disableFileAccess: true,
    disableUrlAccess: true,
    attachDataUrls: true,
  });
  // Stream transport retains Bcc so Gmail can use it for delivery.
  if (!Buffer.isBuffer(info.message))
    throw new Error('The MIME builder did not return a message buffer.');
  const raw = info.message;
  if (raw.byteLength > GMAIL_MAX_MESSAGE_BYTES)
    throw new DraftError(
      'The encoded message exceeds Gmail’s 35 MiB limit. Remove an attachment or reduce the message size.'
    );
  return raw;
}
export async function queueDraft(
  database: DatabaseSync,
  id: string,
  version: number,
  undoSeconds: number,
  now?: number
): Promise<Draft> {
  const draft = checkEditable(database, id, version);
  if (!Number.isFinite(undoSeconds) || undoSeconds <= 0)
    throw new DraftError('Choose a positive Undo Send delay.');
  const account = listAccounts(database).find((item) => item.email === draft.accountEmail);
  if (!account?.refreshToken || !account.enabled)
    throw new DraftError('Reconnect and enable the sending account in Settings.');
  const messageId = `<${randomUUID()}@${draft.accountEmail.split('@')[1]}>`;
  const raw = await buildDraftMime(database, draft, messageId);
  const queuedAt = now ?? Date.now();
  const result = database
    .prepare(
      `UPDATE email_drafts SET status = 'queued', send_at = ?, raw_message = ?, message_id = ?, error = NULL, version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND status IN ('draft','failed')`
    )
    .run(
      queuedAt + undoSeconds * 1000,
      raw,
      messageId,
      new Date(queuedAt).toISOString(),
      id,
      version
    );
  if (!result.changes)
    throw new DraftError('The draft changed before it was queued. Review it and send again.', 409);
  publishStateChange();
  return getDraft(database, id);
}
export function undoQueuedDraft(database: DatabaseSync, id: string): Draft {
  const result = database
    .prepare(
      "UPDATE email_drafts SET status = 'draft', send_at = NULL, raw_message = NULL, version = version + 1, updated_at = ? WHERE id = ? AND status = 'queued'"
    )
    .run(new Date().toISOString(), id);
  if (!result.changes)
    throw new DraftError('Sending has started. This message can no longer be recalled.', 409);
  publishStateChange();
  return getDraft(database, id);
}
export function recoverInterruptedSends(database: DatabaseSync) {
  database
    .prepare(
      "UPDATE email_drafts SET status = 'uncertain', error = 'The server stopped during sending. Check Sent mail before sending again.' WHERE status = 'sending'"
    )
    .run();
}
export async function sendNextDraft(
  database: DatabaseSync,
  request = googleApiRequest,
  now = Date.now()
): Promise<boolean> {
  const row = database
    .prepare(
      "SELECT * FROM email_drafts WHERE status = 'queued' AND send_at <= ? ORDER BY send_at LIMIT 1"
    )
    .get(now);
  if (!row) return false;
  const draft = rowToDraft(database, row);
  const account = listAccounts(database).find((item) => item.email === draft.accountEmail);
  if (!account?.refreshToken || !account.enabled) {
    database
      .prepare(
        "UPDATE email_drafts SET status = 'failed', error = 'Reconnect and enable the sending account before sending again.' WHERE id = ? AND status = 'queued'"
      )
      .run(draft.id);
    publishStateChange();
    return true;
  }
  const claimed = database
    .prepare(
      "UPDATE email_drafts SET status = 'sending', version = version + 1 WHERE id = ? AND status = 'queued'"
    )
    .run(draft.id);
  if (!claimed.changes) return true;
  publishStateChange();
  try {
    const source = draft.sourceEmailId ? getEmail(database, draft.sourceEmailId) : null;
    const sameSubject = (a: string, b: string) =>
      a.replace(/^(re:\s*)+/i, '').trim() === b.replace(/^(re:\s*)+/i, '').trim();
    const threadId =
      (draft.mode === 'reply' || draft.mode === 'replyAll') &&
      source &&
      source.accountEmail === draft.accountEmail &&
      sameSubject(source.subject, draft.subject)
        ? source.threadId
        : null;
    const sent = await request<{ id?: string }>(
      account,
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        data: {
          raw: Buffer.from(row.raw_message as Uint8Array).toString('base64url'),
          ...(threadId ? { threadId } : {}),
        },
      }
    );
    if (!sent.id) throw new Error('Google did not return the sent message ID.');
    database
      .prepare(
        "UPDATE email_drafts SET status = 'sent', sent_gmail_id = ?, raw_message = NULL, error = NULL, updated_at = ? WHERE id = ?"
      )
      .run(sent.id, new Date().toISOString(), draft.id);
    // Index the confirmed sent content without another network request.
    upsertEmails(database, account.email, [
      {
        id: sent.id,
        from: account.email,
        to: [draft.to, draft.cc].filter(Boolean).join(', '),
        subject: draft.subject,
        bodyText: draft.text,
        bodyHtml: draft.html,
        date: new Date().toISOString(),
        labels: ['SENT'],
        threadId: threadId ?? undefined,
        headers: { 'message-id': String(row.message_id), cc: draft.cc },
      },
    ]);
    markArchived(database, account.email, [sent.id]);
  } catch (error) {
    // Sending is not idempotent. Do not automatically repeat an uncertain request.
    database
      .prepare(
        "UPDATE email_drafts SET status = 'uncertain', error = ?, updated_at = ? WHERE id = ? AND status = 'sending'"
      )
      .run(
        error instanceof Error ? error.message : String(error),
        new Date().toISOString(),
        draft.id
      );
  }
  publishStateChange();
  return true;
}
export async function checkUncertainDraft(
  database: DatabaseSync,
  id: string,
  request = googleApiRequest
): Promise<Draft> {
  const draft = getDraft(database, id);
  if (draft.status !== 'uncertain' || !draft.messageId)
    throw new DraftError('This message does not need a send-status check.');
  const account = listAccounts(database).find((item) => item.email === draft.accountEmail);
  if (!account?.refreshToken) throw new DraftError('Reconnect the sending account first.');
  const result = await request<{ messages?: { id: string }[] }>(
    account,
    'https://gmail.googleapis.com/gmail/v1/users/me/messages',
    { params: { q: `in:sent rfc822msgid:${draft.messageId.replace(/[<>]/g, '')}` } }
  );
  if (result.messages?.length)
    database
      .prepare(
        "UPDATE email_drafts SET status = 'sent', sent_gmail_id = ?, error = NULL, raw_message = NULL WHERE id = ?"
      )
      .run(result.messages[0].id, id);
  else
    throw new DraftError(
      'No sent copy was found yet. Check Gmail Sent mail before choosing “Return to draft”. Search results can take time to update.'
    );
  publishStateChange();
  return getDraft(database, id);
}
export function returnUncertainToDraft(database: DatabaseSync, id: string) {
  database
    .prepare(
      "UPDATE email_drafts SET status = 'draft', raw_message = NULL, send_at = NULL, version = version + 1, error = NULL WHERE id = ? AND status = 'uncertain'"
    )
    .run(id);
  publishStateChange();
  return getDraft(database, id);
}
