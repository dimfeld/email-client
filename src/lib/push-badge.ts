// The service worker and the page share the badge count through IndexedDB.
// The service worker adds one when no app window is active, and the page clears it on focus.

const databaseName = 'email-check-push';
const storeName = 'badge';
const countKey = 'count';

function openBadgeDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function updateBadgeCount(next: (count: number) => number): Promise<number> {
  const database = await openBadgeDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.get(countKey);
    let count = 0;
    request.onsuccess = () => {
      count = next(typeof request.result === 'number' ? request.result : 0);
      store.put(count, countKey);
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(count);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

export function incrementBadgeCount(): Promise<number> {
  return updateBadgeCount((count) => count + 1);
}

export async function clearBadgeCount(): Promise<void> {
  await updateBadgeCount(() => 0);
  await navigator.clearAppBadge?.();
}
