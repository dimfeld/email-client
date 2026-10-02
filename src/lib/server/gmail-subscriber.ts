import { PubSub, type Message, type Subscription } from '@google-cloud/pubsub';
import type { DatabaseSync } from 'node:sqlite';
import { gmailHistoryQueue } from './gmail-history-queue';
import {
  clearGmailHistoryProgress,
  loadGmailHistoryDownload,
  loadGmailHistoryProgress,
  saveGmailHistoryDownload,
  saveGmailHistoryProgress,
  type GmailHistoryChange,
} from './gmail-history-progress';
import { createJevClassifier, type EmailClassifier } from './classifier';
import {
  changeEmailLabels,
  getDatabase,
  getIncomingEmail,
  listAccounts,
  setAccountHistoryId,
} from './db';
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
  changes: GmailHistoryChange[];
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
  const changes = new Map<string, GmailHistoryChange>();
  const getChange = (id: string) => {
    let change = changes.get(id);
    if (!change) {
      change = { id, added: false, deleted: false, fetch: false, labels: {} };
      changes.set(id, change);
    }
    return change;
  };
  for (const entry of history) {
    const specificIds = new Set<string>();
    for (const key of ['messagesAdded', 'messagesDeleted', 'labelsAdded', 'labelsRemoved']) {
      const items = Array.isArray(entry[key]) ? (entry[key] as Record<string, unknown>[]) : [];
      for (const item of items) {
        const message = item.message as { id?: unknown } | undefined;
        if (typeof message?.id !== 'string') continue;
        specificIds.add(message.id);
        const change = getChange(message.id);
        if (key === 'messagesAdded') change.added = true;
        else if (key === 'messagesDeleted') change.deleted = true;
        else if (Array.isArray(item.labelIds)) {
          for (const label of item.labelIds) {
            if (typeof label === 'string') change.labels[label] = key === 'labelsAdded';
          }
        } else change.fetch = true;
      }
    }
    // The generic list duplicates specific events. Fetch only events with no details.
    const messages = Array.isArray(entry.messages) ? (entry.messages as { id?: unknown }[]) : [];
    for (const message of messages) {
      if (typeof message.id === 'string' && !specificIds.has(message.id)) {
        getChange(message.id).fetch = true;
      }
    }
  }
  return { historyId: result.historyId, changes: [...changes.values()] };
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

  const database = dependencies.database;
  let history = loadGmailHistoryProgress(database, account.email, currentHistoryId);
  if (!history) {
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
    history = {
      startHistoryId: currentHistoryId,
      ...parseHistoryResult({ history: combined, historyId: latestHistoryId }),
    };
    saveGmailHistoryProgress(database, account.email, history);
  }

  const messages: IncomingEmail[] = [];
  const deletedMessageIds: string[] = [];
  const archivedMessageIds: string[] = [];
  const labelChanges: Array<{ id: string; labels: Record<string, boolean> }> = [];
  for (const change of history.changes) {
    if (change.deleted) {
      deletedMessageIds.push(change.id);
      continue;
    }
    let message = getIncomingEmail(database, account.email, change.id);
    const hidden =
      change.labels.TRASH === true || change.labels.SPAM === true || change.labels.DRAFT === true;
    const needsDownload =
      !hidden && (change.fetch || (!message && (change.added || change.labels.INBOX === true)));
    if (needsDownload) {
      const downloaded = loadGmailHistoryDownload(database, account.email, change.id);
      if (downloaded === undefined) {
        message = await fetchMessage(account, change.id, getMessage);
        saveGmailHistoryDownload(database, account.email, change.id, message);
      } else message = downloaded;
    } else if (message) {
      const labels = new Set(message.labels);
      for (const [label, added] of Object.entries(change.labels)) {
        if (added) labels.add(label);
        else labels.delete(label);
      }
      message = { ...message, labels: [...labels] };
      labelChanges.push({ id: change.id, labels: change.labels });
    } else {
      // An unknown archived message does not need to be imported to apply its label changes.
      continue;
    }
    if (!message || message.labels?.some((label) => label === 'TRASH' || label === 'SPAM')) {
      deletedMessageIds.push(change.id);
    } else if (message.labels?.includes('DRAFT')) {
      continue;
    } else {
      messages.push(message);
      if (!message.labels?.includes('INBOX')) archivedMessageIds.push(change.id);
    }
  }
  for (const change of labelChanges) {
    changeEmailLabels(database, account.email, [change.id], {
      addLabelIds: Object.keys(change.labels).filter((label) => change.labels[label]),
      removeLabelIds: Object.keys(change.labels).filter((label) => !change.labels[label]),
    });
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
  clearGmailHistoryProgress(database, account.email);
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
      void gmailHistoryQueue
        .enqueue(account.email, notification.historyId, async (historyId) => {
          const startedAt = Date.now();
          try {
            account.historyId =
              listAccounts(database).find((item) => item.email === account.email)?.historyId ??
              null;
            const result = await processGmailNotification(
              account,
              { emailAddress: account.email, historyId: historyId ?? notification.historyId },
              {
                database,
                classify: createJevClassifier(),
                extract,
              }
            );
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
            return account.historyId!;
          } catch (error) {
            console.error(`Gmail notification failed for ${account.email}.`, {
              publishedAt: message.publishTime?.toISOString(),
              receivedAt: new Date(receivedAt).toISOString(),
              queueDelayMs: startedAt - receivedAt,
              processingMs: Date.now() - startedAt,
              error,
            });
            throw error;
          }
        })
        .then(
          () => message.ack(),
          () => message.nack()
        );
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
