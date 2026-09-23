import { fail } from '@sveltejs/kit';
import { deleteRemoteImageRule, getDatabase, listRemoteImageRules } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ setHeaders }) => {
  setHeaders({ 'cache-control': 'no-store' });
  return { remoteImageRules: listRemoteImageRules(getDatabase()) };
};

export const actions: Actions = {
  removeRemoteImageRule: async ({ request }) => {
    const fields = await request.formData();
    const kind = fields.get('kind');
    const value = fields.get('value');
    if ((kind !== 'address' && kind !== 'domain') || typeof value !== 'string' || !value) {
      return fail(400, { error: 'The image setting is invalid.' });
    }
    deleteRemoteImageRule(getDatabase(), { kind, value });
    return { message: `Remote images from ${value} now need approval.` };
  },
};
