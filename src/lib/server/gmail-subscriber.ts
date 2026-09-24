import { PubSub, type Message, type Subscription } from '@google-cloud/pubsub';
import type { DatabaseSync } from 'node:sqlite';
import { queueGmailAccountWork } from './gmail-account-queue';
import { createJevClassifier, type EmailClassifier } from './classifier';
import { getDatabase, listAccounts, setAccountHistoryId } from './db';
import { createOpenAIEmailExtractor, type EmailExtractor } from './extractor';
import { getGmailMessage, googleApiRequest, GoogleApiError } from './google-api';
import { ingestGmailPayload } from './ingest';
import { gmailMessageArrivalStats } from './message-arrival-stats';
import type { IncomingEmail } from './types';

export type GmailSyncAccount = {
  email: string;
  refreshToken: string | null;
  historyId: string | null;
};

export type GmailSubscriberAccount = GmailSyncAccount & { subscription: string };

export type GmailNotification = {
  emailAddress: string;
  historyId: string;
};

type HistoryResult = {
  historyId: string;
  messages: string[];
};

type SubscriberDependencies = {
  database: DatabaseSync;
  classify: EmailClassifier;
  extract?: EmailExtractor | null;
  request?: typeof googleApiRequest;
  getMessage?: typeof getGmailMessage;
};

export function groupAccountsBySubscription(
  accounts: GmailSubscriberAccount[]
): Map<string, Map<string, GmailSubscriberAccount>> {
  const groups = new Map<string, Map<string, GmailSubscriberAccount>>();
  for (const account of accounts) {
    let group = groups.get(account.subscription);
    if (!group) {
      group = new Map();
      groups.set(account.subscription, group);
    }
    group.set(account.email.toLowerCase(), account);
  }
  return groups;
}

export function parseGmailNotification(data: Uint8Array): GmailNotification {
  const value = JSON.parse(Buffer.from(data).toString('utf8')) as Record<string, unknown>;
  if (typeof value.emailAddress !== 'string' || value.emailAddress.length === 0) {
    throw new Error('The Gmail notification does not include an emailAddress.');
  }
  const historyId =
    typeof value.historyId === 'string'
      ? value.historyId
      : typeof value.historyId === 'number' && Number.isSafeInteger(value.historyId)
        ? String(value.historyId)
        : null;
  if (historyId === null || !/^\d+$/.test(historyId)) {
    throw new Error('The Gmail notification does not include a valid historyId.');
  }
  return { emailAddress: value.emailAddress, historyId };
}

function isNewerHistoryId(candidate: string, current: string): boolean {
  return BigInt(candidate) > BigInt(current);
}

function parseHistoryResult(value: unknown): HistoryResult {
  if (!value || typeof value !== 'object')
    throw new Error('Google returned invalid Gmail history.');
  const result = value as Record<string, unknown>;
  if (typeof result.historyId !== 'string' || !/^\d+$/.test(result.historyId)) {
    throw new Error('Google Gmail history did not include a valid historyId.');
  }
  const history = Array.isArray(result.history)
    ? (result.history as Array<Record<string, unknown>>)
    : [];
  const messageIds = history.flatMap((entry) =>
    ['messages', 'messagesAdded', 'messagesDeleted', 'labelsAdded', 'labelsRemoved']
      .flatMap((key) =>
        Array.isArray(entry[key]) ? (entry[key] as Array<Record<string, unknown>>) : []
      )
      .flatMap((item) => {
        const message =
          item.message && typeof item.message === 'object'
            ? (item.message as Record<string, unknown>)
            : item;
        return typeof message.id === 'string' ? [message.id] : [];
      })
  );
  return {
    historyId: result.historyId,
    messages: [...new Set(messageIds)],
  };
}

async function loadInitialHistoryId(
  account: GmailSyncAccount,
  database: DatabaseSync,
  request: typeof googleApiRequest
): Promise<string> {
  if (account.historyId) return account.historyId;
  const result = await request<{ historyId?: string }>(
    account,
    'https://gmail.googleapis.com/gmail/v1/users/me/profile'
  );
  const historyId = result.historyId;
  if (typeof historyId !== 'string' || !/^\d+$/.test(historyId))
    throw new Error('The Gmail profile did not include a valid historyId.');
  setAccountHistoryId(database, account.email, historyId);
  account.historyId = historyId;
  return historyId;
}

async function fetchMessage(
  account: GmailSyncAccount,
  messageId: string,
  getMessage: typeof getGmailMessage
): Promise<IncomingEmail | null> {
  try {
    return await getMessage(account, messageId);
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 404) return null;
    throw error;
  }
}

export async function processGmailNotification(
  account: GmailSyncAccount,
  notification: GmailNotification,
  dependencies: SubscriberDependencies
): Promise<{
  stored: number;
  classified: number;
  extracted: number;
  deleted: number;
  archived: number;
}> {
  const request = dependencies.request ?? googleApiRequest;
  const getMessage = dependencies.getMessage ?? getGmailMessage;
  const currentHistoryId = await loadInitialHistoryId(account, dependencies.database, request);
  if (!isNewerHistoryId(notification.historyId, currentHistoryId)) {
    return { stored: 0, classified: 0, extracted: 0, deleted: 0, archived: 0 };
  }

  const combined: Record<string, unknown>[] = [];
  let pageToken: string | undefined;
  let latestHistoryId = notification.historyId;
  do {
    const page = await request<{
      history?: Record<string, unknown>[];
      historyId?: string;
      nextPageToken?: string;
    }>(account, 'https://gmail.googleapis.com/gmail/v1/users/me/history', {
      params: { startHistoryId: currentHistoryId, pageToken },
    });
    combined.push(...(page.history ?? []));
    if (page.historyId) latestHistoryId = page.historyId;
    pageToken = page.nextPageToken;
  } while (pageToken);
  const history = parseHistoryResult({ history: combined, historyId: latestHistoryId });

  const messages: IncomingEmail[] = [];
  const deletedMessageIds: string[] = [];
  const archivedMessageIds: string[] = [];
  for (const messageId of new Set(history.messages)) {
    const message = await fetchMessage(account, messageId, getMessage);
    if (!message || message.labels?.some((label) => label === 'TRASH' || label === 'SPAM')) {
      deletedMessageIds.push(messageId);
    } else if (message.labels?.includes('DRAFT')) {
      continue;
    } else {
      messages.push(message);
      if (!message.labels?.includes('INBOX')) archivedMessageIds.push(messageId);
    }
  }

  const result = await ingestGmailPayload(
    dependencies.database,
    {
      source: 'gmail',
      account: account.email,
      historyId: history.historyId,
      deletedMessageIds,
      messages,
    },
    dependencies.classify,
    dependencies.extract ?? null
  );
  setAccountHistoryId(dependencies.database, account.email, history.historyId);
  account.historyId = history.historyId;
  return { ...result, archived: archivedMessageIds.length };
}

export type GmailSubscribers = {
  subscriptions: Subscription[];
  close(): Promise<void>;
};

export function startGmailSubscribers(): GmailSubscribers | null {
  const database = getDatabase();
  const extract = createOpenAIEmailExtractor();
  const accounts = listAccounts(database)
    .filter(
      (account): account is typeof account & { subscription: string; refreshToken: string } =>
        account.enabled && Boolean(account.subscription) && Boolean(account.refreshToken)
    )
    .map((account) => ({
      email: account.email,
      refreshToken: account.refreshToken,
      subscription: account.subscription,
      historyId: account.historyId,
    }));
  if (accounts.length === 0) {
    console.log('No Pub/Sub subscriptions are configured. The app will run without subscribers.');
    return null;
  }

  const pubsub = new PubSub({ projectId: process.env.GOOGLE_PROJECT_ID || undefined });
  const subscriptions: Subscription[] = [];
  for (const [subscriptionName, accountsByEmail] of groupAccountsBySubscription(accounts)) {
    const subscription = pubsub.subscription(subscriptionName);
    subscriptions.push(subscription);
    console.log(
      `Starting Pub/Sub subscriber ${subscriptionName} for ${accountsByEmail.size} Gmail account(s).`
    );

    subscription.on('message', (message: Message) => {
      const receivedAt = Date.now();
      let notification: GmailNotification;
      try {
        notification = parseGmailNotification(message.data);
      } catch (error) {
        console.error('Acknowledging invalid Gmail Pub/Sub message.', {
          message: message.data.toString('utf8'),
          error,
        });
        message.ack();
        return;
      }

      const account = accountsByEmail.get(notification.emailAddress.toLowerCase());
      if (!account) {
        console.error(
          `Acknowledging Gmail notification for unconfigured account ${notification.emailAddress} on ${subscriptionName}.`
        );
        message.ack();
        return;
      }

      console.info('Gmail Pub/Sub notification received.', {
        account: account.email,
        notificationHistoryId: notification.historyId,
        publishedAt: message.publishTime?.toISOString(),
        receivedAt: new Date(receivedAt).toISOString(),
      });
      void queueGmailAccountWork(account.email, async () => {
        const startedAt = Date.now();
        try {
          account.historyId =
            listAccounts(database).find((item) => item.email === account.email)?.historyId ?? null;
          const result = await processGmailNotification(account, notification, {
            database,
            classify: createJevClassifier(),
            extract,
          });
          gmailMessageArrivalStats.recordAndLog(account.email, 'pubsub', result.stored);
          console.info('Gmail Pub/Sub sync completed.', {
            account: account.email,
            notificationHistoryId: notification.historyId,
            historyId: account.historyId,
            publishedAt: message.publishTime?.toISOString(),
            receivedAt: new Date(receivedAt).toISOString(),
            queueDelayMs: startedAt - receivedAt,
            processingMs: Date.now() - startedAt,
            ...result,
          });
          message.ack();
        } catch (error) {
          console.error(`Gmail notification failed for ${account.email}.`, {
            publishedAt: message.publishTime?.toISOString(),
            receivedAt: new Date(receivedAt).toISOString(),
            queueDelayMs: startedAt - receivedAt,
            processingMs: Date.now() - startedAt,
            error,
          });
          message.nack();
        }
      });
    });
    subscription.on('error', (error) => {
      console.error(`Pub/Sub subscriber failed for ${subscriptionName}.`, error);
    });
  }

  return {
    subscriptions,
    async close() {
      await Promise.all(subscriptions.map((subscription) => subscription.close()));
      await pubsub.close();
    },
  };
}
