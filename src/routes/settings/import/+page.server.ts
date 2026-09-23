import { fail } from '@sveltejs/kit';
import {
  createHistoricalBackfill,
  defaultHistoricalDelayMs,
  historicalBackfillWorker,
  listHistoricalBackfills,
  setHistoricalBackfillPaused,
} from '$lib/server/historical-backfill';
import { getDatabase } from '$lib/server/db';
import { listSettingsAccounts } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ setHeaders, depends }) => {
  depends('app:backfill', 'app:accounts');
  setHeaders({ 'cache-control': 'no-store' });
  const database = getDatabase();
  return {
    accounts: listSettingsAccounts(database),
    historicalBackfills: listHistoricalBackfills(database),
    historicalDelayMs: defaultHistoricalDelayMs,
  };
};

export const actions: Actions = {
  startHistory: async ({ request }) => {
    const fields = await request.formData();
    try {
      const classify = fields.get('classify') === 'on';
      if (classify && !process.env.TYPESAFE_API_KEY)
        throw new Error('Set TYPESAFE_API_KEY before enabling classification.');
      createHistoricalBackfill(getDatabase(), {
        account: String(fields.get('account') ?? ''),
        query: String(fields.get('query') ?? ''),
        after: String(fields.get('after') ?? ''),
        before: String(fields.get('before') ?? ''),
        classify,
        delayMs: Number(fields.get('delaySeconds')) * 1000,
      });
      historicalBackfillWorker().wake();
      return { message: 'Historical import started. You can close this page.' };
    } catch (error) {
      return fail(400, {
        error: error instanceof Error ? error.message : 'Could not start the import.',
      });
    }
  },
  pauseHistory: async ({ request }) => {
    const fields = await request.formData();
    try {
      const paused = fields.get('paused') === 'yes';
      setHistoricalBackfillPaused(getDatabase(), String(fields.get('id') ?? ''), paused);
      historicalBackfillWorker().wake();
      return {
        message: paused
          ? 'Import paused. A request in progress can still finish.'
          : 'Import resumed.',
      };
    } catch (error) {
      return fail(400, {
        error: error instanceof Error ? error.message : 'Could not change the import.',
      });
    }
  },
};
