const queueKey = Symbol.for('email-check.gmail-account-queue');
const shared = globalThis as typeof globalThis & { [queueKey]?: Map<string, Promise<void>> };
const queues = (shared[queueKey] ??= new Map<string, Promise<void>>());

export function queueGmailAccountWork<T>(email: string, work: () => Promise<T>): Promise<T> {
  const key = email.toLowerCase();
  const previous = queues.get(key) ?? Promise.resolve();
  const current = previous.then(work);
  const settled = current.then(
    () => undefined,
    () => undefined
  );
  queues.set(key, settled);
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return current;
}
