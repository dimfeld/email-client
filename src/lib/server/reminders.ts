import type { DatabaseSync } from 'node:sqlite';
import type { PushPayload } from '$lib/push';
import { dueLabel, reminderTime, type Todo } from '$lib/pim';
import { getDatabase } from './db';
import { sendPushNotifications, type SendPush } from './push';
import { subscribeStateChanges } from './state-events';
import { listDueReminders, listPendingReminders, markReminderSent } from './todos';

// setTimeout accepts a signed 32-bit delay.
const MAX_TIMER_MS = 2 ** 31 - 1;

export function reminderPushPayload(todo: Todo): PushPayload {
  return {
    title: todo.title,
    body: `Reminder · ${dueLabel(todo) ?? ''}`,
    url: `/todos?todo=${todo.id}`,
    tag: `todo:${todo.id}`,
  };
}

/** Sends a notification for each reminder that is due, one time per due time. */
export async function sendDueReminders(
  database: DatabaseSync,
  now = new Date(),
  send?: SendPush
): Promise<number> {
  const due = listDueReminders(database, now);
  // Marked first, so a failed or slow push service cannot cause a second notification.
  for (const todo of due) markReminderSent(database, todo.id, now);
  await sendPushNotifications(database, due.map(reminderPushPayload), send);
  return due.length;
}

export type ReminderWorker = { wake(): void; close(): void };

/** Sends reminders at their due times. A change to notes or to-dos sets a new timer. */
export function startReminderWorker(database: DatabaseSync, send?: SendPush): ReminderWorker {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let again = false;
  let closed = false;
  const run = async () => {
    if (closed) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await sendDueReminders(database, new Date(), send);
    } catch (error) {
      console.error('Reminder notifications failed.', error);
    } finally {
      running = false;
    }
    if (closed) return;
    if (again) {
      again = false;
      void run();
      return;
    }
    const next = listPendingReminders(database)
      .map((todo) => reminderTime(todo)!.getTime())
      .reduce((soonest, time) => Math.min(soonest, time), Infinity);
    if (next === Infinity) return;
    clearTimeout(timer);
    timer = setTimeout(() => void run(), Math.min(MAX_TIMER_MS, Math.max(0, next - Date.now())));
    timer.unref?.();
  };
  const unsubscribe = subscribeStateChanges((scopes) => {
    if ([...scopes].some((scope) => scope === 'pim' || scope === 'all')) worker.wake();
  });
  const worker = {
    wake() {
      clearTimeout(timer);
      void run();
    },
    close() {
      closed = true;
      clearTimeout(timer);
      unsubscribe();
    },
  };
  worker.wake();
  return worker;
}

const key = Symbol.for('email-check.reminders');
const shared = globalThis as typeof globalThis & { [key]?: ReminderWorker };
export function reminderWorker(): ReminderWorker {
  return (shared[key] ??= startReminderWorker(getDatabase()));
}
