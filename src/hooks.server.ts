import { historicalBackfillWorker } from '$lib/server/historical-backfill';
import { startGmailSubscribers } from '$lib/server/gmail-subscriber';
import { startGmailBackfill } from '$lib/server/gmail-backfill';
import { startGmailWatchRenewal } from '$lib/server/gmail-watch-renewal';
import { startGoogleDataSync } from '$lib/server/google-auto-sync';

const subscriberKey = Symbol.for('email-check.gmail-subscribers');
const backfillKey = Symbol.for('email-check.gmail-backfill');
const watchRenewalKey = Symbol.for('email-check.gmail-watch-renewal');
const googleDataSyncKey = Symbol.for('email-check.google-data-sync');
const globalSubscribers = globalThis as typeof globalThis & Record<symbol, unknown>;

globalSubscribers[subscriberKey] ??= startGmailSubscribers();
globalSubscribers[backfillKey] ??= startGmailBackfill();
globalSubscribers[watchRenewalKey] ??= startGmailWatchRenewal();
globalSubscribers[googleDataSyncKey] ??= startGoogleDataSync();

historicalBackfillWorker();
