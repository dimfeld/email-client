import { getDatabase, listCalendars } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ setHeaders, depends }) => {
  depends('app:calendar');
  setHeaders({ 'cache-control': 'no-store' });
  return { calendars: listCalendars(getDatabase()) };
};
