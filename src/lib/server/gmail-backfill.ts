import type { DatabaseSync } from 'node:sqlite';
import { createJevClassifier, type EmailClassifier } from './classifier';
import { getDatabase, listAccounts, setAccountLastBackfillAt } from './db';
import { createOpenAIEmailExtractor, type EmailExtractor } from './extractor';
import {
  getGmailMessage,
  googleApiRequest,
  listGmailMessageIds,
  listGmailMessages,
} from './google-api';
import { ingestGmailPayload } from './ingest';
import { gmailMessageArrivalStats } from './message-arrival-stats';
import type { IncomingEmail } from './types';

export const GMAIL_BACKFILL_INTERVAL_MS = 5 * 60 * 1000;
export const GMAIL_BACKFILL_OVERLAP_MS = 5 * 60 * 1000;
export const GMAIL_BACKFILL_INITIAL_LOOKBACK_MS = 60 * 60 * 1000;

type GmailBackfillDependencies = {
  database: DatabaseSync;
  classify: EmailClassifier;
  extract?: EmailExtractor | null;
  listMessages?: typeof listGmailMessages;
  listMessageIds?: typeof listGmailMessageIds;
  getMessage?: typeof getGmailMessage;
  request?: typeof googleApiRequest;
  now?: () => Date;
  intervalMs?: number;
};

export type GmailBackfillResult = {
  accounts: number;
  succeeded: number;
  failed: number;
  stored: number;
  classified: number;
};

export function isGmailRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:\b429\b|rate[\s_-]*limit|too many requests|quota(?:[\s_-]*exceeded)?|resource[\s_-]*exhausted|userRateLimitExceeded)/i.test(
    message
  );
}

export function buildGmailBackfillQuery(lastBackfillAt: string | null, now: Date): string {
  const recordedAt = lastBackfillAt === null ? Number.NaN : Date.parse(lastBackfillAt);
  const startAt = Number.isFinite(recordedAt)
    ? recordedAt - GMAIL_BACKFILL_OVERLAP_MS
    : now.getTime() - GMAIL_BACKFILL_INITIAL_LOOKBACK_MS;
  return `after:${Math.max(0, Math.floor(startAt / 1000))}`;
}

async function backfillAccount(
  account: ReturnType<typeof listAccounts>[number],
  dependencies: GmailBackfillDependencies,
  now: Date
): Promise<{ stored: number; classified: number }> {
  const query = buildGmailBackfillQuery(account.lastBackfillAt, now);
  let messages: IncomingEmail[];
  if (dependencies.listMessages) {
    messages = await dependencies.listMessages(account, query);
  } else {
    const ids = await (dependencies.listMessageIds ?? listGmailMessageIds)(account, query);
    const getMessage = dependencies.getMessage ?? getGmailMessage;
    messages = [];
    for (const id of ids) {
      messages.push(await getMessage(account, id));
    }
  }
  const ingested = await ingestGmailPayload(
    dependencies.database,
    {
      source: 'gmail',
      account: account.email,
      deletedMessageIds: [],
      messages,
    },
    dependencies.classify,
    dependencies.extract ?? null,
    dependencies.request
  );
  gmailMessageArrivalStats.recordAndLog(account.email, 'backfill', ingested.stored);
  setAccountLastBackfillAt(dependencies.database, account.email, now.toISOString());
  console.info('Gmail backfill completed.', {
    account: account.email,
    query,
    matched: messages.length,
    stored: ingested.stored,
    classified: ingested.classified,
  });
  return { stored: ingested.stored, classified: ingested.classified };
}

export async function backfillGmail(
  dependencies: GmailBackfillDependencies
): Promise<GmailBackfillResult> {
  const now = (dependencies.now ?? (() => new Date()))();
  const accounts = listAccounts(dependencies.database).filter(
    (account) => account.enabled && account.refreshToken
  );
  const results = await Promise.all(
    accounts.map(async (account) => {
      try {
        const result = await backfillAccount(account, dependencies, now);
        return { ok: true, ...result };
      } catch (error) {
        if (isGmailRateLimitError(error)) {
          console.warn(`Gmail backfill deferred for ${account.email}.`, error);
        } else {
          console.error(`Gmail backfill failed for ${account.email}.`, error);
        }
        return { ok: false, stored: 0, classified: 0 };
      }
    })
  );
  return {
    accounts: accounts.length,
    succeeded: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    stored: results.reduce((total, result) => total + result.stored, 0),
    classified: results.reduce((total, result) => total + result.classified, 0),
  };
}

export type GmailBackfill = {
  close(): void;
};

export function startGmailBackfill({
  database,
  listMessages,
  listMessageIds,
  getMessage,
  request,
  classify,
  extract,
  intervalMs = GMAIL_BACKFILL_INTERVAL_MS,
}: Partial<GmailBackfillDependencies> & { database?: DatabaseSync } = {}): GmailBackfill {
  const activeDatabase = database ?? getDatabase();
  if (!listAccounts(activeDatabase).some((account) => account.enabled && account.refreshToken)) {
    return { close() {} };
  }
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await backfillGmail({
        database: activeDatabase,
        listMessages,
        listMessageIds,
        getMessage,
        request,
        classify: classify ?? createJevClassifier(),
        extract: extract === undefined ? createOpenAIEmailExtractor() : extract,
      });
    } catch (error) {
      console.error('Gmail backfill run failed.', error);
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(() => void run(), intervalMs);
  return {
    close() {
      clearInterval(timer);
    },
  };
}
