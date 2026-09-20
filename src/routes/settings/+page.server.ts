import { fail } from '@sveltejs/kit';
import { CategoryValidationError, deleteCategory, getDatabase, listCategories, saveCategory } from '$lib/server/db';
import type { CategoryLevel } from '$lib/server/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	return { categories: listCategories(getDatabase()) };
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
	}
};
