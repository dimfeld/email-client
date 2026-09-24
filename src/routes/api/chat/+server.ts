import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getDatabase, getEmail, listAccounts } from '$lib/server/db';
import { chatWithEmail } from '$lib/server/email-chat';
import type { ChatStreamEvent } from '$lib/email-chat';
import type { RequestHandler } from './$types';

const requestSchema = z.object({
  account: z.string().nullable(),
  currentMessageId: z.number().int().positive().nullable().optional(),
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1) }))
    .min(1),
});

export const POST: RequestHandler = async ({ request, url }) => {
  if (request.headers.get('origin') !== url.origin)
    return json({ error: 'The request origin is invalid.' }, { status: 403 });
  let input;
  try {
    input = requestSchema.parse(await request.json());
  } catch {
    return json({ error: 'Send a question and a valid conversation.' }, { status: 400 });
  }
  if (input.messages.at(-1)?.role !== 'user')
    return json({ error: 'The last message must be a question.' }, { status: 400 });
  const database = getDatabase();
  if (input.account && !listAccounts(database).some((account) => account.email === input.account))
    return json({ error: 'The selected account is not available.' }, { status: 400 });
  if (
    input.messages.length === 1 &&
    input.currentMessageId &&
    !getEmail(database, input.currentMessageId, input.account ?? undefined)
  )
    return json({ error: 'The open message is not available.' }, { status: 400 });
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        if (!cancelled) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        const answer = await chatWithEmail(
          database,
          input.messages,
          input.account ?? undefined,
          request.signal,
          {},
          input.currentMessageId ?? undefined,
          (progress) => send({ type: 'progress', progress }),
          (text) => send({ type: 'answer-text', text })
        );
        send({ type: 'answer', answer });
      } catch (error) {
        if (!request.signal.aborted && !cancelled)
          send({
            type: 'error',
            error: error instanceof Error ? error.message : 'Email chat failed.',
          });
      } finally {
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  });
};
