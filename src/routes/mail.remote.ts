import { query } from '$app/server';
import { z } from 'zod';
import { addDays, isDateKey } from '$lib/calendar';
import {
  getDatabase,
  getThreadEmails,
  listAccounts,
  listCalendars,
  listCalendarEventsBetween,
  listCategories,
  listRemoteImageRules,
} from '$lib/server/db';
import { SearchQueryError } from '$lib/server/email-search';
import { countMailFilters, listMail, type MailList } from '$lib/server/mail-list';

const accountInput = z.string().nullable();
const listInput = z.object({
  account: accountInput,
  search: z.string(),
  filter: z.string(),
  view: z.enum(['inbox', 'sent']),
  limit: z.number().int().positive(),
});
const eventsInput = z.object({ account: accountInput, day: z.string().refine(isDateKey) });
const messageInput = z.object({ account: accountInput, id: z.number().int().positive() });

export const getMailAccounts = query(() =>
  listAccounts(getDatabase()).map(({ refreshToken, ...account }) => ({
    ...account,
    connected: Boolean(refreshToken),
  }))
);

export const getMailCategories = query(() => listCategories(getDatabase()));

export const getRemoteImageRules = query(() => listRemoteImageRules(getDatabase()));

export const getMailCalendars = query(() => listCalendars(getDatabase()));

export const getMailEvents = query(eventsInput, ({ account, day }) =>
  listCalendarEventsBetween(getDatabase(), day, addDays(day, 1)).filter(
    (event) => !account || event.accountEmail === account
  )
);

export const getMailList = query(listInput, ({ account, search, filter, view, limit }) => {
  try {
    const list = listMail(getDatabase(), {
      account: account ?? undefined,
      search,
      filter,
      view,
      limit,
    });
    return { ...list, searchError: null as string | null };
  } catch (error) {
    if (!(error instanceof SearchQueryError)) throw error;
    return {
      emails: [] as MailList['emails'],
      hasMore: false,
      counts: {} as MailList['counts'],
      searchError: error.message,
    };
  }
});

export const getMailCounts = query(
  z.object({ account: accountInput, search: z.string() }),
  ({ account, search }) => countMailFilters(getDatabase(), account ?? undefined, search)
);

export const getSelectedThread = query(messageInput, ({ account, id }) =>
  getThreadEmails(getDatabase(), id, account ?? undefined)
);
