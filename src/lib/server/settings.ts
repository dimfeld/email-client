import type { DatabaseSync } from 'node:sqlite';
import { listAccounts } from './db';

/** Accounts for the settings pages, without their OAuth tokens. */
export function listSettingsAccounts(database: DatabaseSync) {
  return listAccounts(database).map(({ refreshToken, ...account }) => ({
    ...account,
    connected: Boolean(refreshToken),
  }));
}
