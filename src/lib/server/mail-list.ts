import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { emailSummaryFromRow } from './db';
import { parseSearchQuery } from './email-search';
import type { EmailSummary } from './types';

export type MailFilter = string;
export type MailView = 'inbox' | 'sent';
export type MailListQuery = {
  account?: string;
  view?: MailView;
  search: string;
  filter: MailFilter;
  limit: number;
};
export type MailList = {
  emails: EmailSummary[];
  hasMore: boolean;
  counts: Record<MailFilter, number>;
};

const effectiveLevel = "CASE WHEN c.level = 'auto' THEN e.importance ELSE c.level END";

function membership(filter: MailFilter, view: MailView): { sql: string; params: SQLInputValue[] } {
  if (view === 'sent' || filter === 'all') return { sql: '1', params: [] };
  const category =
    filter === 'pending'
      ? 'e.category IS NULL AND e.in_inbox = 1'
      : filter === 'important'
        ? `${effectiveLevel} = 'important'`
        : filter === 'useful'
          ? `${effectiveLevel} IN ('important', 'useful')`
          : 'e.category = ?';
  return {
    sql: `EXISTS (SELECT 1 FROM emails e LEFT JOIN categories c ON c.id = e.category
      WHERE e.account_email = t.account_email AND e.thread_key = t.thread_key
        AND e.deleted_at IS NULL AND e.is_sent = 0 AND ${category})`,
    params: filter === 'pending' || filter === 'important' || filter === 'useful' ? [] : [filter],
  };
}

function searchCandidates(search: string, account?: string) {
  const parsed = parseSearchQuery(search);
  if (parsed.empty) return null;
  const where = ['e.deleted_at IS NULL'];
  const params: SQLInputValue[] = [];
  const join = parsed.match ? 'JOIN email_fts ON email_fts.rowid = e.id' : '';
  if (account) {
    where.push('e.account_email = ?');
    params.push(account);
  }
  if (parsed.match) {
    where.push('email_fts MATCH ?');
    params.push(parsed.match);
  }
  for (const { field, value } of parsed.filters) {
    if (field === 'from' || field === 'to') {
      where.push(
        `email_search_address(e.${field === 'from' ? 'from_address' : 'to_addresses'}, ?) = 1`
      );
      params.push(value);
    } else {
      where.push(`e.sort_time ${field === 'after' ? '>=' : '<'} ?`);
      params.push(Date.parse(`${value}T00:00:00Z`));
    }
  }
  return {
    join,
    where: where.join(' AND '),
    params,
    rank: parsed.match ? 'bm25(email_fts)' : '-e.sort_time',
  };
}

export function listMail(database: DatabaseSync, query: MailListQuery): MailList {
  const view = query.view ?? 'inbox';
  const label = view === 'sent' ? 'SENT' : 'INBOX';
  const filter = membership(query.filter, view);
  const accountWhere = query.account ? 'AND t.account_email = ?' : '';
  const accountParams = query.account ? [query.account] : [];
  const search = query.search ? searchCandidates(query.search, query.account) : null;
  if (query.search && !search) return { emails: [], hasMore: false, counts: {} };
  let candidateSql: string;
  let params: SQLInputValue[];
  if (search) {
    // FTS rank is computed before grouping. One matching message is kept per thread.
    const matchSql = `SELECT e.account_email, e.thread_key, e.id AS match_id,
      ${search.rank} AS rank FROM emails e ${search.join} WHERE ${search.where}`;
    candidateSql = `WITH matches AS (${matchSql}), ranked AS (
      SELECT *, row_number() OVER (PARTITION BY account_email, thread_key ORDER BY rank, match_id DESC) AS position
      FROM matches)
      SELECT t.account_email, t.thread_key, t.latest_email_id, r.match_id AS preview_id,
        t.latest_sort_time FROM ranked r
      JOIN threads t ON t.account_email = r.account_email AND t.thread_key = r.thread_key
      WHERE r.position = 1 AND ${filter.sql}
      ORDER BY r.rank, t.latest_sort_time DESC LIMIT ?`;
    params = [...search.params, ...filter.params, query.limit + 1];
  } else {
    if (view === 'inbox' && query.filter !== 'all') {
      const filterKey = ['important', 'useful', 'pending'].includes(query.filter)
        ? query.filter
        : `category:${query.filter}`;
      candidateSql = `SELECT t.account_email, t.thread_key, t.latest_email_id,
        t.latest_email_id AS preview_id, t.latest_sort_time
        FROM thread_filters t WHERE t.filter = ? ${accountWhere}
          AND EXISTS (SELECT 1 FROM thread_labels l WHERE l.account_email = t.account_email
            AND l.thread_key = t.thread_key AND l.label = 'INBOX')
        ORDER BY t.latest_sort_time DESC, t.latest_email_id DESC LIMIT ?`;
      params = [filterKey, ...accountParams, query.limit + 1];
    } else {
      candidateSql = `SELECT t.account_email, t.thread_key, t.latest_email_id,
        t.latest_email_id AS preview_id, t.latest_sort_time
        FROM thread_labels t WHERE t.label = ? ${accountWhere}
        ORDER BY t.latest_sort_time DESC, t.latest_email_id DESC LIMIT ?`;
      params = [label, ...accountParams, query.limit + 1];
    }
  }
  const candidates = database.prepare(candidateSql).all(...params) as {
    account_email: string;
    thread_key: string;
    latest_email_id: number;
    preview_id: number;
    latest_sort_time: number;
  }[];
  const summary =
    database.prepare(`SELECT e.id, e.account_email, e.thread_key, e.from_address, e.subject,
    e.message_date, e.snippet, e.labels_json, e.category, e.importance FROM emails e WHERE e.id = ?`);
  const category = database.prepare(`SELECT e.category, e.importance FROM emails e
    WHERE e.account_email = ? AND e.thread_key = ? AND e.deleted_at IS NULL
      AND e.is_sent = 0 AND e.category IS NOT NULL ORDER BY e.sort_time DESC, e.id DESC LIMIT 1`);
  const categoryMatch = database.prepare(`SELECT e.category, e.importance FROM emails e
    WHERE e.account_email = ? AND e.thread_key = ? AND e.deleted_at IS NULL
      AND e.is_sent = 0 AND e.category = ? ORDER BY e.sort_time DESC, e.id DESC LIMIT 1`);
  const threadLabel = database.prepare(`SELECT 1 FROM thread_labels
    WHERE account_email = ? AND thread_key = ? AND label = ?`);
  const emails = candidates.slice(0, query.limit).map((candidate) => {
    const row = summary.get(candidate.preview_id) as Record<string, unknown>;
    const result = emailSummaryFromRow(row);
    const displayCategory =
      view === 'sent'
        ? null
        : query.filter !== 'all' && !['important', 'useful', 'pending'].includes(query.filter)
          ? categoryMatch.get(candidate.account_email, candidate.thread_key, query.filter)
          : category.get(candidate.account_email, candidate.thread_key);
    const classification = displayCategory as
      | { category: string; importance: EmailSummary['importance'] }
      | undefined;
    result.category = classification?.category ?? null;
    result.importance = classification?.importance ?? null;
    result.threadKey = candidate.thread_key;
    result.latestMessageId = candidate.latest_email_id;
    result.latestSortTime = candidate.latest_sort_time;
    result.unread = Boolean(
      threadLabel.get(candidate.account_email, candidate.thread_key, 'UNREAD')
    );
    result.starred = Boolean(
      threadLabel.get(candidate.account_email, candidate.thread_key, 'STARRED')
    );
    return result;
  });
  return { emails, hasMore: candidates.length > query.limit, counts: {} };
}

export function countMailFilters(
  database: DatabaseSync,
  account?: string,
  searchText = ''
): Record<MailFilter, number> {
  if (searchText) {
    const search = searchCandidates(searchText, account);
    if (!search) return {};
    const matched = database
      .prepare(`SELECT DISTINCT e.account_email, e.thread_key
      FROM emails e ${search.join} WHERE ${search.where}`)
      .all(...search.params) as { account_email: string; thread_key: string }[];
    const membership = database.prepare(`SELECT e.category, e.in_inbox,
      ${effectiveLevel} AS level FROM emails e LEFT JOIN categories c ON c.id = e.category
      WHERE e.account_email = ? AND e.thread_key = ? AND e.deleted_at IS NULL AND e.is_sent = 0`);
    const sets = new Map<string, Set<string>>();
    const add = (filter: string, key: string) => {
      if (!sets.has(filter)) sets.set(filter, new Set());
      sets.get(filter)!.add(key);
    };
    for (const thread of matched) {
      const key = `${thread.account_email}\0${thread.thread_key}`;
      add('all', key);
      const members = membership.all(thread.account_email, thread.thread_key) as {
        category: string | null;
        in_inbox: number;
        level: string | null;
      }[];
      for (const member of members) {
        if (member.category) add(member.category, key);
        else if (member.in_inbox) add('pending', key);
        if (member.level === 'important') add('important', key);
        if (member.level === 'important' || member.level === 'useful') add('useful', key);
      }
    }
    return Object.fromEntries([...sets].map(([key, value]) => [key, value.size]));
  }
  const all = database
    .prepare(`SELECT count(*) AS total FROM thread_labels
    WHERE label = 'INBOX'${account ? ' AND account_email = ?' : ''}`)
    .get(...(account ? [account] : [])) as { total: number };
  const rows = database
    .prepare(`SELECT f.filter, count(*) AS total FROM thread_filters f
    JOIN thread_labels l ON l.account_email = f.account_email AND l.thread_key = f.thread_key
      AND l.label = 'INBOX'
    ${account ? 'WHERE f.account_email = ?' : ''}
    GROUP BY f.filter`)
    .all(...(account ? [account] : [])) as { filter: string; total: number }[];
  return {
    all: all.total,
    ...Object.fromEntries(
      rows.map((row) => [
        row.filter.startsWith('category:') ? row.filter.slice(9) : row.filter,
        row.total,
      ])
    ),
  };
}
