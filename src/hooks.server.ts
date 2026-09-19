import { startGmailSubscribers } from '$lib/server/gmail-subscriber';
import { startGmailWatchRenewal } from '$lib/server/gmail-watch-renewal';

const subscriberKey = Symbol.for('email-check.gmail-subscribers');
const watchRenewalKey = Symbol.for('email-check.gmail-watch-renewal');
const globalSubscribers = globalThis as typeof globalThis & Record<symbol, unknown>;

globalSubscribers[subscriberKey] ??= startGmailSubscribers();
globalSubscribers[watchRenewalKey] ??= startGmailWatchRenewal();
