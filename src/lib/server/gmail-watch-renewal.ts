import type { DatabaseSync } from 'node:sqlite';
import { getDatabase, listAccounts, setAccountHistoryId } from './db';
import { googleApiRequest } from './google-api';

export const GMAIL_WATCH_RENEWAL_INTERVAL_MS = 24 * 60 * 60 * 1000;

type GmailWatchRenewalDependencies = {
  database: DatabaseSync;
  request?: typeof googleApiRequest;
  intervalMs?: number;
};

function parseWatchRenewalHistoryId(value: unknown): string {
  if (!value || typeof value !== 'object') {
    throw new Error('Google watch renewal returned an invalid result.');
  }
  const result = value as Record<string, unknown>;
  const historyId = result.historyId;
  if (typeof historyId !== 'string' || !/^\d+$/.test(historyId)) {
    throw new Error('Google watch renewal did not return a valid historyId.');
  }
  return historyId;
}

async function renewAccountWatch(
  account: ReturnType<typeof listAccounts>[number],
  request: typeof googleApiRequest
): Promise<string> {
  if (!account.topic) throw new Error(`No Pub/Sub topic is configured for ${account.email}.`);
  const result = await request(account, 'https://gmail.googleapis.com/gmail/v1/users/me/watch', {
    method: 'POST',
    data: { topicName: account.topic },
  });
  return parseWatchRenewalHistoryId(result);
}

export async function renewGmailWatches(
  database: DatabaseSync,
  request: typeof googleApiRequest = googleApiRequest,
  accountEmail?: string
): Promise<{ renewed: number; failed: number }> {
  const accounts = listAccounts(database).filter(
    (account) =>
      account.enabled &&
      account.topic &&
      (account.refreshToken || accountEmail === account.email) &&
      (accountEmail === undefined || account.email === accountEmail)
  );
  const results = await Promise.all(
    accounts.map(async (account) => {
      try {
        const historyId = await renewAccountWatch(account, request);
        if (!account.historyId) setAccountHistoryId(database, account.email, historyId);
        console.log(`Renewed Gmail watch for ${account.email}.`);
        return true;
      } catch (error) {
        console.error(`Gmail watch renewal failed for ${account.email}.`, error);
        return false;
      }
    })
  );
  return {
    renewed: results.filter(Boolean).length,
    failed: results.filter((result) => !result).length,
  };
}

export type GmailWatchRenewal = {
  close(): void;
};

export function startGmailWatchRenewal({
  database = getDatabase(),
  request = googleApiRequest,
  intervalMs = GMAIL_WATCH_RENEWAL_INTERVAL_MS,
}: Partial<GmailWatchRenewalDependencies> = {}): GmailWatchRenewal {
  const renew = () => {
    void renewGmailWatches(database, request);
  };

  const timer = setInterval(renew, intervalMs);
  return {
    close() {
      clearInterval(timer);
    },
  };
}
