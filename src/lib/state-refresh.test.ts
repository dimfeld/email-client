import { expect, it } from 'bun:test';
import { createStateRefresh } from './state-refresh';

it('serializes refreshes and keeps one pending refresh for changes received during a fetch', async () => {
  const first = Promise.withResolvers<void>();
  const secondStarted = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  let calls = 0;
  const refresh = createStateRefresh(() => {
    calls += 1;
    if (calls === 1) return first.promise;
    secondStarted.resolve();
    return second.promise;
  });
  refresh.request();
  refresh.request();
  refresh.request();
  expect(calls).toBe(1);
  first.resolve();
  await secondStarted.promise;
  expect(calls).toBe(2);
  refresh.request();
  refresh.stop();
  second.resolve();
  await second.promise;
  refresh.request();
  expect(calls).toBe(2);
});

it('accepts a later refresh after a failed fetch', async () => {
  const failed = Promise.withResolvers<void>();
  const succeeded = Promise.withResolvers<void>();
  let calls = 0;
  const refresh = createStateRefresh(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error('Offline');
      succeeded.resolve();
    },
    () => failed.resolve()
  );
  refresh.request();
  await failed.promise;
  refresh.request();
  await succeeded.promise;
  expect(calls).toBe(2);
  refresh.stop();
});

it('holds changes during navigation and refreshes them after navigation ends', async () => {
  const first = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<void>();
  let calls = 0;
  const refresh = createStateRefresh(async () => {
    calls++;
    if (calls === 1) await first.promise;
    else finished.resolve();
  });
  refresh.request();
  refresh.pause();
  refresh.request();
  first.resolve();
  await first.promise;
  await Promise.resolve();
  expect(calls).toBe(1);
  refresh.resume();
  await finished.promise;
  expect(calls).toBe(2);
  refresh.stop();
});

it('merges the scopes of requests made during a running refresh', async () => {
  const first = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<void>();
  const seen: string[][] = [];
  const refresh = createStateRefresh(async (scopes) => {
    seen.push([...scopes]);
    if (seen.length === 1) await first.promise;
    else finished.resolve();
  });
  refresh.request(['mail']);
  refresh.request(['drafts']);
  refresh.request(['calendar', 'drafts']);
  first.resolve();
  await finished.promise;
  expect(seen).toEqual([['mail'], ['drafts', 'calendar']]);
  refresh.stop();
});
