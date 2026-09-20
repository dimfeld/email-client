import { fail } from '@sveltejs/kit';
import { CategoryValidationError, deleteCategory, getDatabase, listAccounts, listCategories, saveCategory } from '$lib/server/db';
import { syncConfiguredGoogleAccounts } from '$lib/server/google-sync';
import type { CategoryLevel } from '$lib/server/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ setHeaders, depends }) => {
	depends('app:state');
	setHeaders({ 'cache-control': 'no-store' });
	const database = getDatabase();
	return {
		categories: listCategories(database),
		accounts: listAccounts(database).map(({ refreshToken, ...account }) => ({ ...account, connected: Boolean(refreshToken) }))
	};
};

export const actions: Actions = {
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
			return { message: `Synced ${result.contacts} contacts, ${result.calendars} calendars, and ${result.events} events for ${account}.` };
		} catch (error) {
			return fail(502, { error: error instanceof Error ? error.message : String(error) });
		}
	}
};
