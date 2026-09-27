import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { deletePushSubscription, getDatabase, savePushSubscription } from '$lib/server/db';
import type { RequestHandler } from './$types';

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

/** Saves the browser's push subscription. The client sends it again each time the app opens. */
export const POST: RequestHandler = async ({ request }) => {
  const parsed = subscriptionSchema.safeParse(await request.json());
  if (!parsed.success) return json({ error: 'The push subscription is invalid.' }, { status: 400 });
  savePushSubscription(getDatabase(), parsed.data);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request }) => {
  const parsed = z.object({ endpoint: z.string() }).safeParse(await request.json());
  if (!parsed.success) return json({ error: 'The endpoint is invalid.' }, { status: 400 });
  deletePushSubscription(getDatabase(), parsed.data.endpoint);
  return json({ ok: true });
};
