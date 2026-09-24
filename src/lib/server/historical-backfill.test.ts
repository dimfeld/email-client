import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, listEmails, upsertAccount } from './db';
import {
  createHistoricalBackfill,
  getHistoricalBackfill,
  runHistoricalBackfillStep,
  setHistoricalBackfillPaused,
} from './historical-backfill';
import { searchEmails } from './email-search';
import { GoogleApiError, type googleApiRequest } from './google-api';

let database = createDatabase(':memory:');
let directory: string | undefined;
afterEach(() => {
  database.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
  database = createDatabase(':memory:');
});
function create(now = 0) {
  upsertAccount(database, { email: 'owner@test.com', refreshToken: 'test' });
  return createHistoricalBackfill(
    database,
    { account: 'owner@test.com', query: 'from:example.com', classify: false, delayMs: 250 },
    new Date(now)
  );
}

test('saves each message, resumes after reopen, and does not put archived history in the inbox', async () => {
  directory = mkdtempSync(join(tmpdir(), 'historical-mail-'));
  const path = join(directory, 'db.sqlite');
  database.close();
  database = createDatabase(path);
  let now = 0;
  const id = create();
  const pages: (string | undefined)[] = [];
  const request = (async (_account, _url, options) => {
    pages.push(options?.params?.pageToken as string | undefined);
    return options?.params?.pageToken
      ? { messages: [{ id: 'b' }] }
      : { messages: [{ id: 'a' }], nextPageToken: 'next' };
  }) as typeof googleApiRequest;
  const downloads: string[] = [];
  const step = () =>
    runHistoricalBackfillStep({
      database,
      request,
      now: () => now,
      getMessage: async (_, gmailId) => {
        downloads.push(gmailId);
        return { id: gmailId, subject: 'History', labels: gmailId === 'a' ? [] : ['INBOX'] };
      },
    });
  await step();
  now += 250;
  await step();
  expect(getHistoricalBackfill(database, id)?.downloaded).toBe(1);
  database.close();
  database = createDatabase(path);
  now += 250;
  await step();
  now += 250;
  await step();
  now += 250;
  await step();
  expect(getHistoricalBackfill(database, id)).toMatchObject({
    status: 'complete',
    downloaded: 2,
    processed: 2,
  });
  expect(pages).toEqual([undefined, 'next']);
  expect(downloads).toEqual(['a', 'b']);
  expect(listEmails(database).map((email) => email.gmailId)).toEqual(['b']);
  expect(searchEmails(database, 'History')).toHaveLength(2);
});

test('honors Retry-After, keeps the cursor, and can pause during a request', async () => {
  let now = 0;
  const id = create();
  const request = (async () => ({ messages: [{ id: 'a' }] })) as typeof googleApiRequest;
  await runHistoricalBackfillStep({ database, request, now: () => now });
  now = 250;
  let attempts = 0;
  const deps = {
    database,
    request,
    now: () => now,
    getMessage: async () => {
      attempts++;
      throw new GoogleApiError('rate limit', 429, 5000);
    },
  };
  await runHistoricalBackfillStep(deps);
  expect(getHistoricalBackfill(database, id)).toMatchObject({
    pendingIds: ['a'],
    retryCount: 1,
    nextRunAt: 5250,
  });
  now = 5249;
  expect(await runHistoricalBackfillStep(deps)).toBe(false);
  expect(attempts).toBe(1);
  setHistoricalBackfillPaused(database, id, true, now);
  now = 6000;
  expect(await runHistoricalBackfillStep(deps)).toBe(false);
  setHistoricalBackfillPaused(database, id, false, now);
  await runHistoricalBackfillStep({
    ...deps,
    getMessage: async () => {
      setHistoricalBackfillPaused(database, id, true, now);
      return { id: 'a', subject: 'Saved' };
    },
  });
  expect(getHistoricalBackfill(database, id)).toMatchObject({
    status: 'paused',
    downloaded: 1,
    pendingIds: [],
  });
});

test('skips vanished messages and restarts an expired page token without duplicate work', async () => {
  let now = 0;
  const id = create();
  let calls = 0;
  const fetched: string[] = [];
  const request = (async () => {
    calls++;
    if (calls === 2) throw new GoogleApiError('Invalid page token', 400);
    return calls === 1
      ? { messages: [{ id: 'a' }], nextPageToken: 'expired' }
      : { messages: [{ id: 'a' }, { id: 'gone' }] };
  }) as typeof googleApiRequest;
  const deps = {
    database,
    request,
    now: () => now,
    getMessage: async (_account: unknown, gmailId: string) => {
      fetched.push(gmailId);
      if (gmailId === 'gone') throw new GoogleApiError('not found', 404);
      return { id: gmailId };
    },
  };
  while (getHistoricalBackfill(database, id)?.status !== 'complete') {
    await runHistoricalBackfillStep(deps);
    now += 250;
  }
  expect(fetched).toEqual(['a', 'gone']);
  expect(getHistoricalBackfill(database, id)).toMatchObject({
    downloaded: 1,
    missing: 1,
    processed: 2,
  });
});

test('coalesces simultaneous worker steps and retains failure details for resume', async () => {
  const id = create();
  let calls = 0;
  const request = (async () => {
    calls++;
    await Promise.resolve();
    throw new GoogleApiError('Reconnect the account', 401);
  }) as typeof googleApiRequest;
  await Promise.all([
    runHistoricalBackfillStep({ database, request, now: () => 0 }),
    runHistoricalBackfillStep({ database, request, now: () => 0 }),
  ]);
  expect(calls).toBe(1);
  expect(getHistoricalBackfill(database, id)).toMatchObject({
    status: 'failed',
    error: 'Reconnect the account',
  });
  setHistoricalBackfillPaused(database, id, false, 0);
  expect(getHistoricalBackfill(database, id)?.status).toBe('queued');
});

test('rejects invalid ranges and disconnected accounts before queueing', () => {
  expect(() =>
    createHistoricalBackfill(database, {
      account: 'missing',
      query: '',
      classify: false,
      delayMs: 250,
    })
  ).toThrow('Connect');
  create();
  expect(() =>
    createHistoricalBackfill(database, {
      account: 'owner@test.com',
      query: '',
      after: '2026-01-01',
      before: '2025-01-01',
      classify: false,
      delayMs: 250,
    })
  ).toThrow('end date');
});
