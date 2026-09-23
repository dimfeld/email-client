import { UNDO_SEND_SECONDS } from '$lib/composer';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getDatabase } from '$lib/server/db';
import {
  addDraftAttachment,
  checkUncertainDraft,
  createDraft,
  discardDraft,
  DraftError,
  getDraft,
  queueDraft,
  removeDraftAttachment,
  returnUncertainToDraft,
  saveDraft,
  undoQueuedDraft,
} from '$lib/server/composer';
import { outboxWorker } from '$lib/server/outbox';
import type { RequestHandler } from './$types';
const idSchema = z.string().uuid();
const inputSchema = z.object({
  accountEmail: z.string(),
  to: z.string(),
  cc: z.string(),
  bcc: z.string(),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
});
const versionSchema = z.number().int().nonnegative();
const commands = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    mode: z.enum(['new', 'reply', 'replyAll', 'forward']),
    account: z.string().optional(),
    sourceEmailId: z.number().int().positive().optional(),
    to: z.string().optional(),
  }),
  z.object({
    action: z.literal('preview'),
    mode: z.enum(['new', 'reply', 'replyAll', 'forward']),
    account: z.string().optional(),
    sourceEmailId: z.number().int().positive().optional(),
  }),
  z.object({
    action: z.literal('saveNew'),
    mode: z.enum(['new', 'reply', 'replyAll', 'forward']),
    account: z.string().optional(),
    sourceEmailId: z.number().int().positive().optional(),
    input: inputSchema,
  }),
  z.object({ action: z.literal('save'), id: idSchema, version: versionSchema, input: inputSchema }),
  z.object({ action: z.literal('discard'), id: idSchema, version: versionSchema }),
  z.object({ action: z.literal('queue'), id: idSchema, version: versionSchema }),
  z.object({ action: z.literal('undo'), id: idSchema }),
  z.object({ action: z.literal('check'), id: idSchema }),
  z.object({ action: z.literal('recover'), id: idSchema, checkedSent: z.literal(true) }),
  z.object({
    action: z.literal('removeAttachment'),
    id: idSchema,
    version: versionSchema,
    attachmentId: idSchema,
  }),
]);
export const GET: RequestHandler = ({ url }) => {
  try {
    return json(getDraft(getDatabase(), idSchema.parse(url.searchParams.get('id'))), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Draft unavailable.' },
      { status: error instanceof DraftError ? error.status : 400 }
    );
  }
};
export const POST: RequestHandler = async ({ request, url }) => {
  if (request.headers.get('origin') !== url.origin)
    return json({ error: 'Invalid request origin.' }, { status: 403 });
  try {
    const db = getDatabase();
    if (request.headers.get('content-type')?.startsWith('multipart/form-data')) {
      const fields = await request.formData();
      const file = fields.get('file');
      if (!(file instanceof File)) throw new DraftError('Choose an attachment.');
      return json(
        addDraftAttachment(
          db,
          idSchema.parse(fields.get('id')),
          versionSchema.parse(Number(fields.get('version'))),
          file.name,
          file.type,
          new Uint8Array(await file.arrayBuffer())
        )
      );
    }
    const command = commands.parse(await request.json());
    let draft;
    switch (command.action) {
      case 'create':
        draft = await createDraft(db, command);
        if (command.to && command.mode === 'new')
          draft = saveDraft(db, draft.id, draft.version, { ...draft, to: command.to });
        break;
      case 'preview':
        draft = await createDraft(db, command, undefined, false);
        break;
      case 'saveNew':
        draft = await createDraft(db, command);
        draft = saveDraft(db, draft.id, draft.version, command.input);
        break;
      case 'save':
        draft = saveDraft(db, command.id, command.version, command.input);
        break;
      case 'discard':
        discardDraft(db, command.id, command.version);
        return json({ discarded: true });
      case 'queue':
        draft = await queueDraft(db, command.id, command.version, UNDO_SEND_SECONDS);
        outboxWorker().wake();
        break;
      case 'undo':
        draft = undoQueuedDraft(db, command.id);
        break;
      case 'check':
        draft = await checkUncertainDraft(db, command.id);
        break;
      case 'recover':
        draft = returnUncertainToDraft(db, command.id);
        break;
      case 'removeAttachment':
        draft = removeDraftAttachment(db, command.id, command.version, command.attachmentId);
        break;
    }
    return json(draft, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Composer request failed.' },
      {
        status:
          error instanceof DraftError ? error.status : error instanceof z.ZodError ? 400 : 502,
      }
    );
  }
};
