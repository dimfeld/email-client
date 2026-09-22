import { query } from '$app/server';
import { z } from 'zod';
import { addDays, isDateKey } from '$lib/calendar';
import { getDatabase, getEmail, listAccounts, listCalendars, listCalendarEventsBetween, listCategories, listEmailSummaries, listRemoteImageRules } from '$lib/server/db';
import { searchEmailSummaries, SearchQueryError } from '$lib/server/email-search';

const accountInput = z.string().nullable();
const listInput = z.object({ account: accountInput, search: z.string() });
const eventsInput = z.object({ account: accountInput, day: z.string().refine(isDateKey) });
const messageInput = z.object({ account: accountInput, id: z.number().int().positive() });

export const getMailAccounts = query(() =>
	listAccounts(getDatabase()).map(({ refreshToken, ...account }) => ({ ...account, connected: Boolean(refreshToken) }))
);

export const getMailCategories = query(() => listCategories(getDatabase()));

export const getRemoteImageRules = query(() => listRemoteImageRules(getDatabase()));

export const getMailCalendars = query(() => listCalendars(getDatabase()));

export const getMailEvents = query(eventsInput, ({ account, day }) =>
	listCalendarEventsBetween(getDatabase(), day, addDays(day, 1))
		.filter((event) => !account || event.accountEmail === account)
);

export const getMailList = query(listInput, ({ account, search }) => {
	const database = getDatabase();
	try {
		return {
			emails: search ? searchEmailSummaries(database, search, account ?? undefined) : listEmailSummaries(database, account ?? undefined),
			searchError: null as string | null
		};
	} catch (error) {
		if (!(error instanceof SearchQueryError)) throw error;
		return { emails: [] as ReturnType<typeof listEmailSummaries>, searchError: error.message };
	}
});

export const getSelectedMessage = query(messageInput, ({ account, id }) =>
	getEmail(getDatabase(), id, account ?? undefined)
);
