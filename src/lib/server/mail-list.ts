import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { emailSummaryColumns, emailSummaryFromRow } from './db';
import { searchEmailSource, type EmailSource } from './email-search';
import type { EmailSummary } from './types';

/** `all`, `important`, `useful`, `pending` (no category yet), or a category ID. */
export type MailFilter = string;

export type MailListQuery = {
  account?: string;
  search: string;
  filter: MailFilter;
  /** Rows to return, from the start of the list. More pages load by a larger limit. */
  limit: number;
};

export type MailList = {
  emails: EmailSummary[];
  hasMore: boolean;
  /** Message count for each filter, before the filter is applied. */
  counts: Record<MailFilter, number>;
};

// Mirrors effectiveImportance(): the category level, or the message's own level for `auto`.
const effectiveImportanceSql = `CASE WHEN c.level = 'auto' THEN e.importance ELSE c.level END`;

function inboxSource(account?: string): EmailSource {
  const where = ['e.deleted_at IS NULL', 'e.archived_at IS NULL'];
  const params: SQLInputValue[] = [];
  if (account) {
    where.push('e.account_email = ?');
    params.push(account);
  }
  return {
    from: 'emails e',
    where,
    params,
    orderBy: 'email_search_date(e.message_date) DESC, e.first_seen_at DESC, e.id DESC',
  };
}

function filterCondition(filter: MailFilter): { sql: string; params: SQLInputValue[] } | null {
  if (filter === 'all') return null;
  if (filter === 'important') return { sql: `${effectiveImportanceSql} = 'important'`, params: [] };
  if (filter === 'useful')
    return { sql: `${effectiveImportanceSql} IN ('important', 'useful')`, params: [] };
  if (filter === 'pending') return { sql: 'e.category IS NULL', params: [] };
  return { sql: 'e.category = ?', params: [filter] };
}

function countByFilter(database: DatabaseSync, source: EmailSource): Record<MailFilter, number> {
  const rows = database
    .prepare(
      `SELECT e.category AS category, ${effectiveImportanceSql} AS level, COUNT(*) AS total
       FROM ${source.from} LEFT JOIN categories c ON c.id = e.category
       WHERE ${source.where.join(' AND ')} GROUP BY e.category, level`
    )
    .all(...source.params) as { category: string | null; level: string | null; total: number }[];
  const counts: Record<MailFilter, number> = { all: 0, important: 0, useful: 0, pending: 0 };
  const add = (key: MailFilter, total: number) => (counts[key] = (counts[key] ?? 0) + total);
  for (const { category, level, total } of rows) {
    add('all', total);
    add(category ?? 'pending', total);
    if (level === 'important') add('important', total);
    if (level === 'important' || level === 'useful') add('useful', total);
  }
  return counts;
}

/** Lists the inbox, or search results when `search` is set. Throws SearchQueryError. */
export function listMail(database: DatabaseSync, query: MailListQuery): MailList {
  const source = query.search
    ? searchEmailSource(query.search, query.account)
    : inboxSource(query.account);
  if (!source) return { emails: [], hasMore: false, counts: countByFilter(database, emptySource) };
  const condition = filterCondition(query.filter);
  const where = condition ? [...source.where, condition.sql] : source.where;
  const rows = database
    .prepare(
      `SELECT ${emailSummaryColumns} FROM ${source.from} LEFT JOIN categories c ON c.id = e.category
       WHERE ${where.join(' AND ')} ORDER BY ${source.orderBy} LIMIT ?`
    )
    // One extra row tells whether another page exists.
    .all(...source.params, ...(condition?.params ?? []), query.limit + 1);
  return {
    emails: rows.slice(0, query.limit).map(emailSummaryFromRow),
    hasMore: rows.length > query.limit,
    counts: countByFilter(database, source),
  };
}

const emptySource: EmailSource = { from: 'emails e', where: ['0'], params: [], orderBy: 'e.id' };
