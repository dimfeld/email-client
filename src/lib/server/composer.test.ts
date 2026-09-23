import { afterEach, expect, test } from 'bun:test';
import { simpleParser } from 'mailparser';
import { createDatabase, getEmail, listEmails, upsertAccount, upsertEmails } from './db';
import {
  addDraftAttachment,
  buildDraftMime,
  checkUncertainDraft,
  cleanComposeHtml,
  createDraft,
  getDraft,
  parseRecipients,
  queueDraft,
  recoverInterruptedSends,
  saveDraft,
  sendNextDraft,
  undoQueuedDraft,
} from './composer';
import type { googleApiRequest } from './google-api';
import { UNDO_SEND_SECONDS } from '$lib/composer';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
let database = createDatabase(':memory:');
let directory: string | undefined;
afterEach(() => {
  database.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
  database = createDatabase(':memory:');
});
function account() {
  upsertAccount(database, { email: 'me@test.com', refreshToken: 'test' });
}
async function ready() {
  account();
  const draft = await createDraft(database, { mode: 'new', account: 'me@test.com' });
  return saveDraft(database, draft.id, draft.version, {
    ...draft,
    to: 'Recipient <recipient@test.com>',
    subject: 'Report ✓',
    html: '<h2>Report</h2><p><strong>Ready</strong></p>',
    text: 'Report\nReady',
  });
}

test('stores drafts durably, rejects stale saves, and strips active HTML', async () => {
  directory = mkdtempSync(join(tmpdir(), 'mail-drafts-'));
  const path = join(directory, 'db.sqlite');
  database.close();
  database = createDatabase(path);
  const draft = await ready();
  database.close();
  database = createDatabase(path);
  expect(getDraft(database, draft.id)).toMatchObject({
    html: draft.html,
    subject: 'Report ✓',
    version: 1,
  });
  expect(() => saveDraft(database, draft.id, 0, draft)).toThrow('another window');
  expect(
    cleanComposeHtml(
      '<p onclick="bad()">Hello<script>bad()</script><a href="javascript:bad()">click</a></p>'
    )
  ).toBe('<p>Hello<a>click</a></p>');
  expect(() => parseRecipients('a@test.com\r\nBcc: bad@test.com')).toThrow('line breaks');
  expect(() => parseRecipients('not-an-email')).toThrow('Check');
});

test('MIME preserves Unicode, To/Cc/Bcc, HTML, text, attachments, and inline images', async () => {
  let draft = await ready();
  draft = saveDraft(database, draft.id, draft.version, {
    ...draft,
    cc: 'cc@test.com',
    bcc: 'hidden@test.com',
    html: draft.html + '<img src="data:image/png;base64,aGVsbG8=" alt="test">',
  });
  draft = addDraftAttachment(
    database,
    draft.id,
    draft.version,
    'report.txt',
    'text/plain',
    Buffer.from('attachment contents')
  );
  const parsed = await simpleParser(await buildDraftMime(database, draft, '<sent-id@test.com>'));
  expect(parsed.subject).toBe('Report ✓');
  expect(parsed.text).toContain('Ready');
  expect(parsed.html).toContain('<h2>Report</h2>');
  expect(parsed.headers.get('bcc')).toMatchObject({ value: [{ address: 'hidden@test.com' }] });
  expect(
    parsed.attachments.find((file) => file.filename === 'report.txt')?.content.toString()
  ).toBe('attachment contents');
  expect(parsed.attachments.some((file) => Boolean(file.cid))).toBe(true);
});

test('reply all uses Reply-To, removes own accounts and duplicates, and keeps threading', async () => {
  account();
  upsertAccount(database, { email: 'alias@test.com' });
  upsertEmails(database, 'me@test.com', [
    {
      id: 'original',
      labels: ['INBOX'],
      threadId: 'thread-1',
      from: 'sender@test.com',
      to: 'me@test.com, colleague@test.com',
      subject: 'Planning',
      bodyText: 'Original text',
      headers: {
        'message-id': '<original@test.com>',
        'reply-to': 'reply@test.com',
        cc: 'colleague@test.com, alias@test.com, other@test.com',
        references: '<earlier@test.com>',
      },
    },
  ]);
  const source = listEmails(database)[0];
  const draft = await createDraft(database, { mode: 'replyAll', sourceEmailId: source.id });
  expect(draft.to).toBe('reply@test.com');
  expect(draft.cc).toBe('colleague@test.com, other@test.com');
  expect(draft.bcc).toBe('');
  const parsed = await simpleParser(await buildDraftMime(database, draft, '<reply@test.com>'));
  expect(parsed.inReplyTo).toBe('<original@test.com>');
  expect(parsed.references).toEqual(['<earlier@test.com>', '<original@test.com>']);
  let sentData: unknown;
  const request = (async (_account, _url, options) => {
    sentData = options?.data;
    return { id: 'sent-reply' };
  }) as typeof googleApiRequest;
  await queueDraft(database, draft.id, draft.version, UNDO_SEND_SECONDS, 0);
  await sendNextDraft(database, request, 10_000);
  expect(sentData).toMatchObject({ threadId: 'thread-1' });
});

test('forward loads original attachments and starts a new conversation', async () => {
  account();
  upsertEmails(database, 'me@test.com', [
    {
      id: 'original',
      from: 'sender@test.com',
      subject: 'Attachment',
      bodyText: 'Original',
      labels: ['INBOX'],
    },
  ]);
  const source = listEmails(database)[0];
  const request = (async (_account, url) =>
    url.includes('/attachments/')
      ? { data: Buffer.from('forwarded bytes').toString('base64url') }
      : {
          id: 'original',
          threadId: 'thread-1',
          payload: {
            headers: [
              { name: 'From', value: 'sender@test.com' },
              { name: 'Subject', value: 'Attachment' },
              { name: 'Message-ID', value: '<original@test.com>' },
            ],
            parts: [
              {
                mimeType: 'text/plain',
                body: { data: Buffer.from('Original').toString('base64url') },
              },
              {
                filename: 'original.txt',
                mimeType: 'text/plain',
                body: { attachmentId: 'file-1' },
              },
              { filename: 'empty.txt', mimeType: 'text/plain', body: { data: '' } },
            ],
          },
        }) as typeof googleApiRequest;
  let draft = await createDraft(database, { mode: 'forward', sourceEmailId: source.id }, request);
  expect(draft.attachments.map((file) => file.filename)).toEqual(['original.txt', 'empty.txt']);
  expect(draft.to).toBe('');
  draft = saveDraft(database, draft.id, draft.version, { ...draft, to: 'new@test.com' });
  const parsed = await simpleParser(await buildDraftMime(database, draft, '<forward@test.com>'));
  expect(parsed.inReplyTo).toBeUndefined();
  expect(parsed.attachments[0].content.toString()).toBe('forwarded bytes');
  expect(parsed.attachments[1].content.length).toBe(0);
});

test('Undo Send prevents delivery and restores an editable draft', async () => {
  const draft = await ready();
  let sent = 0;
  const request = (async () => {
    sent++;
    return { id: 'sent' };
  }) as typeof googleApiRequest;
  const queued = await queueDraft(database, draft.id, draft.version, UNDO_SEND_SECONDS, 1000);
  expect(queued.sendAt).toBe(11_000);
  expect(await sendNextDraft(database, request, 10_999)).toBe(false);
  expect(() => saveDraft(database, draft.id, queued.version, draft)).toThrow('Undo Send');
  const restored = undoQueuedDraft(database, draft.id);
  expect(restored.status).toBe('draft');
  expect(restored.html).toBe(draft.html);
  expect(await sendNextDraft(database, request, 11_000)).toBe(false);
  expect(sent).toBe(0);
});

test('queued sends survive restart and are claimed only once', async () => {
  directory = mkdtempSync(join(tmpdir(), 'mail-outbox-'));
  const path = join(directory, 'db.sqlite');
  database.close();
  database = createDatabase(path);
  const draft = await ready();
  await queueDraft(database, draft.id, draft.version, UNDO_SEND_SECONDS, 0);
  database.close();
  database = createDatabase(path);
  recoverInterruptedSends(database);
  let sent = 0;
  const request = (async () => {
    sent++;
    await Promise.resolve();
    return { id: 'sent-once' };
  }) as typeof googleApiRequest;
  await Promise.all([
    sendNextDraft(database, request, 10_000),
    sendNextDraft(database, request, 10_000),
  ]);
  expect(sent).toBe(1);
  expect(getDraft(database, draft.id).status).toBe('sent');
  expect(() => undoQueuedDraft(database, draft.id)).toThrow('no longer');
  const stored = database.prepare("SELECT id FROM emails WHERE gmail_id = 'sent-once'").get()!;
  expect(getEmail(database, Number(stored.id))?.subject).toBe('Report ✓');
});

test('does not resend after an uncertain response, and can check Gmail for the sent copy', async () => {
  const draft = await ready();
  await queueDraft(database, draft.id, draft.version, UNDO_SEND_SECONDS, 0);
  let calls = 0;
  const request = (async () => {
    calls++;
    throw new Error('Connection lost');
  }) as typeof googleApiRequest;
  await sendNextDraft(database, request, 10_000);
  await sendNextDraft(database, request, 20_000);
  expect(calls).toBe(1);
  expect(getDraft(database, draft.id).status).toBe('uncertain');
  const check = (async (_account, _url, options) => {
    expect(options?.params?.q).toContain('rfc822msgid:');
    return { messages: [{ id: 'sent-remotely' }] };
  }) as typeof googleApiRequest;
  expect((await checkUncertainDraft(database, draft.id, check)).status).toBe('sent');
});

test('new sends store the thread ID returned by Gmail', async () => {
  const draft = await ready();
  await queueDraft(database, draft.id, draft.version, UNDO_SEND_SECONDS, 0);
  const request = (async () => ({
    id: 'new-sent',
    threadId: 'gmail-thread',
  })) as typeof googleApiRequest;
  await sendNextDraft(database, request, 10_000);
  const row = database
    .prepare("SELECT thread_id, labels_json FROM emails WHERE gmail_id = 'new-sent'")
    .get();
  expect(row).toMatchObject({ thread_id: 'gmail-thread', labels_json: '["SENT"]' });
});
