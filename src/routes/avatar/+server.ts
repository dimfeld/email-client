import { senderAddress } from '$lib/remote-images';
import { senderAvatar } from '$lib/server/avatars';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const account = url.searchParams.get('account');
  const address = senderAddress(url.searchParams.get('from') ?? '');
  if (!account || !address) return new Response(null, { status: 404 });
  return (await senderAvatar(account, address)) ?? new Response(null, { status: 404 });
};
