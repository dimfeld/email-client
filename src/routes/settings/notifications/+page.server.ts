import { getVapidPublicKey } from '$lib/server/push';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ setHeaders }) => {
  setHeaders({ 'cache-control': 'no-store' });
  return { vapidPublicKey: getVapidPublicKey() };
};
