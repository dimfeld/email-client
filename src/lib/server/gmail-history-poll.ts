import type { DatabaseSync } from 'node:sqlite';
import { createJevClassifier, type EmailClassifier } from './classifier';
import { getDatabase, listAccounts, setAccountHistoryId } from './db';
import { createOpenAIEmailExtractor, type EmailExtractor } from './extractor';
import { gmailHistoryQueue } from './gmail-history-queue';
import { GMAIL_BACKFILL_INTERVAL_MS } from './gmail-backfill';
import { processGmailNotification } from './gmail-subscriber';
import { getGmailMessage, googleApiRequest, isGoogleRateLimitError } from './google-api';

type GmailHistoryPollDependencies = {
  database: DatabaseSync;
  classify: EmailClassifier;
  extract?: EmailExtractor | null;
  request?: typeof googleApiRequest;
  getMessage?: typeof getGmailMessage;
  intervalMs?: number;
};

export async function pollGmailHistory(
  dependencies: GmailHistoryPollDependencies,
  runningAccounts = new Set<string>()
): Promise<void> {
  const database = dependencies.database;
  const request = dependencies.request ?? googleApiRequest;
  const accounts = listAccounts(database).filter(
    (account) => account.enabled && account.refreshToken && !runningAccounts.has(account.email)
  );
  await Promise.all(
    accounts.map((account) => {
      runningAccounts.add(account.email);
      return gmailHistoryQueue
        .enqueue(account.email, null, async (targetHistoryId) => {
          const current = listAccounts(database).find((item) => item.email === account.email);
          if (!current?.enabled || !current.refreshToken) {
            throw new Error(`Gmail account ${account.email} is not available for history sync.`);
          }
          const profile = targetHistoryId
            ? { historyId: targetHistoryId }
            : await request<{ historyId?: string }>(
                current,
                'https://gmail.googleapis.com/gmail/v1/users/me/profile'
              );
          if (typeof profile.historyId !== 'string' || !/^\d+$/.test(profile.historyId)) {
            throw new Error('The Gmail profile did not include a valid historyId.');
          }
          if (!current.historyId) {
            setAccountHistoryId(database, current.email, profile.historyId);
            console.info('Gmail history poll initialized.', {
              account: current.email,
              historyId: profile.historyId,
            });
            return profile.historyId;
          }
          const result = await processGmailNotification(
            current,
            { emailAddress: current.email, historyId: profile.historyId },
            {
              database,
              classify: dependencies.classify,
              extract: dependencies.extract,
              request,
              getMessage: dependencies.getMessage,
            }
          );
          console.info('Gmail history poll completed.', {
            account: current.email,
            historyId: current.historyId,
            ...result,
          });
          return current.historyId!;
        })
        .catch((error) => {
          if (isGoogleRateLimitError(error)) {
            console.warn(`Gmail history poll deferred for ${account.email}.`, error);
          } else {
            console.error(`Gmail history poll failed for ${account.email}.`, error);
          }
        })
        .finally(() => runningAccounts.delete(account.email));
    })
  );
}

export function startGmailHistoryPoll({
  database = getDatabase(),
  classify = createJevClassifier(),
  extract = createOpenAIEmailExtractor(),
  request,
  getMessage,
  intervalMs = GMAIL_BACKFILL_INTERVAL_MS,
}: Partial<GmailHistoryPollDependencies> = {}): { close(): void } {
  const runningAccounts = new Set<string>();
  const run = () => {
    void pollGmailHistory(
      { database, classify, extract, request, getMessage },
      runningAccounts
    ).catch((error) => console.error('Gmail history poll run failed.', error));
  };
  run();
  const timer = setInterval(run, intervalMs);
  return { close: () => clearInterval(timer) };
}
