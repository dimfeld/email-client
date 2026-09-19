import { startGmailSubscribers } from '$lib/server/gmail-subscriber';

const subscriberKey = Symbol.for('email-check.gmail-subscribers');
const globalSubscribers = globalThis as typeof globalThis & Record<symbol, unknown>;

globalSubscribers[subscriberKey] ??= startGmailSubscribers();
