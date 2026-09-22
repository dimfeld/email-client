import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getDatabase, listAccounts } from '$lib/server/db';
import { chatWithEmail } from '$lib/server/email-chat';
import type { RequestHandler } from './$types';

const requestSchema = z.object({
  account: z.string().nullable(),
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
  try {
    return json(
      await chatWithEmail(database, input.messages, input.account ?? undefined, request.signal),
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Email chat failed.' },
      { status: 502 }
    );
  }
};
