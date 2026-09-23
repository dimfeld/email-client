import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { isDateKey } from '$lib/calendar';
import { emailFromRow, emailSummaryColumns, emailSummaryFromRow } from './db';
import type { EmailSummary, StoredEmail } from './types';

export class SearchQueryError extends Error {}

export function emailBodyText(text: string, html: string | null): string {
  return (
    text ||
    (html ?? '')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#(\d+);/g, (_, code) =>
        String.fromCodePoint(Number(code) <= 0x10ffff ? Number(code) : 0xfffd)
      )
  );
}

export function registerSearchFunctions(database: DatabaseSync) {
  database.function('email_search_body', { deterministic: true }, (text, html) =>
    emailBodyText(String(text ?? ''), html === null ? null : String(html))
  );
  database.function('email_search_date', { deterministic: true }, (value) => {
    const text = String(value ?? '').trim();
    const date = /^\d{13}$/.test(text) ? Number(text) : Date.parse(text);
    return Number.isNaN(date) ? null : date;
  });
  database.function('email_search_address', { deterministic: true }, (addresses, filter) => {
    const query = String(filter).toLowerCase().replace(/^@/, '');
    const emails =
      String(addresses)
        .toLowerCase()
        .match(/[^\s<>,;"()]+@[^\s<>,;"()]+/g) ?? [];
    return Number(
      emails.some((email) =>
        query.includes('@')
          ? email === query
          : email.split('@')[1] === query || email.endsWith(`.${query}`)
      )
    );
  });
}

export function installEmailSearch(database: DatabaseSync) {
  if (database.prepare("SELECT name FROM sqlite_master WHERE name = 'email_fts'").get()) return;
  database.exec(`CREATE VIRTUAL TABLE email_fts USING fts5(subject, sender, recipients, body, snippet);
		INSERT INTO email_fts(rowid, subject, sender, recipients, body, snippet)
		SELECT id, subject, from_address, to_addresses, email_search_body(body_text, body_html), snippet FROM emails WHERE deleted_at IS NULL;
		CREATE TRIGGER email_fts_insert AFTER INSERT ON emails WHEN new.deleted_at IS NULL BEGIN
			INSERT INTO email_fts(rowid, subject, sender, recipients, body, snippet) VALUES
			(new.id, new.subject, new.from_address, new.to_addresses, email_search_body(new.body_text, new.body_html), new.snippet);
		END;
		CREATE TRIGGER email_fts_delete AFTER DELETE ON emails BEGIN
			DELETE FROM email_fts WHERE rowid = old.id;
		END;
		CREATE TRIGGER email_fts_update AFTER UPDATE OF subject, from_address, to_addresses, body_text, body_html, snippet, deleted_at ON emails BEGIN
			DELETE FROM email_fts WHERE rowid = old.id;
			INSERT INTO email_fts(rowid, subject, sender, recipients, body, snippet)
			SELECT new.id, new.subject, new.from_address, new.to_addresses, email_search_body(new.body_text, new.body_html), new.snippet WHERE new.deleted_at IS NULL;
		END;`);
}

export function parseSearchQuery(query: string) {
  const terms: string[] = [];
  const filters: { field: 'from' | 'to' | 'after' | 'before'; value: string }[] = [];
  const tokens = query.match(/(?:[^\s"]|"[^"]*")+/g) ?? [];
  if ((query.match(/"/g)?.length ?? 0) % 2)
    throw new SearchQueryError('Close the quote for the exact phrase.');
  for (const token of tokens) {
    const filter = /^(from|to|after|before):(.*)$/i.exec(token);
    if (filter) {
      const field = filter[1].toLowerCase() as (typeof filters)[number]['field'];
      const value = filter[2].replace(/^"|"$/g, '');
      if (!value) throw new SearchQueryError(`Add a value after ${field}:.`);
      if ((field === 'after' || field === 'before') && !isDateKey(value))
        throw new SearchQueryError(`Use YYYY-MM-DD for ${field}:.`);
      filters.push({ field, value });
    } else {
      const value = token.replace(/^"|"$/g, '');
      if (/[\p{L}\p{N}]/u.test(value)) terms.push(`"${value.replaceAll('"', '""')}"`);
    }
  }
  return {
    match: terms.join(' AND '),
    filters,
    empty: tokens.length > 0 && terms.length === 0 && filters.length === 0,
  };
}

/** The FROM, WHERE, and ORDER BY parts of a search, for callers that add filters or paging. */
export type EmailSource = {
  from: string;
  where: string[];
  params: SQLInputValue[];
  orderBy: string;
};

/** Returns null when the query has no searchable terms. */
export function searchEmailSource(query: string, account?: string): EmailSource | null {
  const parsed = parseSearchQuery(query);
  if (parsed.empty) return null;
  const where = ['e.deleted_at IS NULL'];
  const params: SQLInputValue[] = [];
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
      where.push(`email_search_date(e.message_date) ${field === 'after' ? '>=' : '<'} ?`);
      params.push(Date.parse(`${value}T00:00:00Z`));
    }
  }
  return {
    from: `emails e${parsed.match ? ' JOIN email_fts ON email_fts.rowid = e.id' : ''}`,
    where,
    params,
    orderBy: `${parsed.match ? 'bm25(email_fts), ' : ''}email_search_date(e.message_date) DESC, e.id DESC`,
  };
}

function searchEmailRows(
  database: DatabaseSync,
  query: string,
  account?: string,
  page?: { offset: number; limit: number },
  summary = false
) {
  const source = searchEmailSource(query, account);
  if (!source) return [];
  const params = [...source.params];
  const pagination = page ? ' LIMIT ? OFFSET ?' : '';
  if (page) params.push(page.limit, page.offset);
  return database
    .prepare(`SELECT ${summary ? emailSummaryColumns : 'e.*'} FROM ${source.from}
		WHERE ${source.where.join(' AND ')} ORDER BY ${source.orderBy}${pagination}`)
    .all(...params);
}

export function searchEmails(
  database: DatabaseSync,
  query: string,
  account?: string,
  page?: { offset: number; limit: number }
): StoredEmail[] {
  return searchEmailRows(database, query, account, page).map(emailFromRow);
}

export function searchEmailSummaries(
  database: DatabaseSync,
  query: string,
  account?: string
): EmailSummary[] {
  return searchEmailRows(database, query, account, undefined, true).map(emailSummaryFromRow);
}
