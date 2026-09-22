import { createHistoricalBackfill, defaultHistoricalDelayMs, historicalBackfillWorker, listHistoricalBackfills, setHistoricalBackfillPaused } from '$lib/server/historical-backfill';
import { fail } from '@sveltejs/kit';
import { CategoryValidationError, deleteCategory, getDatabase, listAccounts, listCalendars, listCategories, saveCategory } from '$lib/server/db';
import { syncConfiguredGoogleAccounts } from '$lib/server/google-sync';
import type { CategoryLevel } from '$lib/server/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ setHeaders, depends }) => {
	depends('app:state');
	setHeaders({ 'cache-control': 'no-store' });
	const database = getDatabase();
	return {
		categories: listCategories(database),
		calendars: listCalendars(database),
		historicalBackfills: listHistoricalBackfills(database),
		historicalDelayMs: defaultHistoricalDelayMs,
		accounts: listAccounts(database).map(({ refreshToken, ...account }) => ({ ...account, connected: Boolean(refreshToken) }))
	};
};

export const actions: Actions = {
	startHistory: async ({ request }) => {
		const fields = await request.formData();
		try {
			const classify = fields.get('classify') === 'on';
			if (classify && !process.env.TYPESAFE_API_KEY) throw new Error('Set TYPESAFE_API_KEY before enabling classification.');
			createHistoricalBackfill(getDatabase(), {
				account: String(fields.get('account') ?? ''), query: String(fields.get('query') ?? ''),
				after: String(fields.get('after') ?? ''), before: String(fields.get('before') ?? ''),
				classify, delayMs: Number(fields.get('delaySeconds')) * 1000
			});
			historicalBackfillWorker().wake();
			return { message: 'Historical import started. You can close this page.' };
		} catch (error) { return fail(400, { error: error instanceof Error ? error.message : 'Could not start the import.' }); }
	},
	pauseHistory: async ({ request }) => {
		const fields = await request.formData();
		try {
			const paused = fields.get('paused') === 'yes';
			setHistoricalBackfillPaused(getDatabase(), String(fields.get('id') ?? ''), paused);
			historicalBackfillWorker().wake();
			return { message: paused ? 'Import paused. A request in progress can still finish.' : 'Import resumed.' };
		} catch (error) { return fail(400, { error: error instanceof Error ? error.message : 'Could not change the import.' }); }
	},
	save: async ({ request }) => {
		const fields = await request.formData();
		const values = {
			id: String(fields.get('id') ?? ''),
			name: String(fields.get('name') ?? ''),
			description: String(fields.get('description') ?? ''),
			level: String(fields.get('level') ?? '') as CategoryLevel
		};
		try {
			saveCategory(getDatabase(), { ...values, id: values.id || undefined });
			return { message: 'Category saved.' };
		} catch (error) {
			if (error instanceof CategoryValidationError) return fail(400, { error: error.message, values });
			throw error;
		}
	},
	remove: async ({ request }) => {
		const fields = await request.formData();
		deleteCategory(getDatabase(), String(fields.get('id') ?? ''));
		return { message: 'Category removed. Its messages now need classification.' };
	},
	syncGoogle: async ({ request }) => {
		const fields = await request.formData();
		const account = String(fields.get('account') ?? '');
		if (!account) return fail(400, { error: 'Choose an account to sync.' });
		try {
			const [{ result }] = await syncConfiguredGoogleAccounts(getDatabase(), account);
			return {
				message: result.deferred
					? `Google rate limit reached. Saved progress for ${account}; the next sync will resume from the last completed page.`
					: `Synced ${result.contacts} contacts, ${result.calendars} calendars, and ${result.events} events for ${account}.`
			};
		} catch (error) {
			return fail(502, { error: error instanceof Error ? error.message : String(error) });
		}
	}
};
