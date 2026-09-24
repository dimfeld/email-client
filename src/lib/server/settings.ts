import type { DatabaseSync } from 'node:sqlite';
import { listAccounts } from './db';

/** Accounts for the settings pages, without their OAuth tokens. */
export function listSettingsAccounts(database: DatabaseSync) {
  return listAccounts(database).map(({ refreshToken, ...account }) => ({
    ...account,
    connected: Boolean(refreshToken),
  }));
}

/** Counts of the local data for each account, keyed by account email. */
export function listAccountStats(database: DatabaseSync) {
  const count = (table: string, where = '') =>
    new Map(
      (
        database
          .prepare(
            `SELECT account_email, COUNT(*) AS count FROM ${table} ${where} GROUP BY account_email`
          )
          .all() as Array<{ account_email: string; count: number }>
      ).map((row) => [row.account_email, row.count])
    );
  const messages = count('emails', 'WHERE deleted_at IS NULL');
  const contacts = count('contacts');
  const calendars = count('calendars');
  return new Map(
    listAccounts(database).map(({ email }) => [
      email,
      {
        messages: messages.get(email) ?? 0,
        contacts: contacts.get(email) ?? 0,
        calendars: calendars.get(email) ?? 0,
      },
    ])
  );
}
