/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/// <reference types="@sveltejs/kit" />

import { build, files, version } from '$service-worker';
import type { PushPayload } from '$lib/push';
import { incrementBadgeCount } from '$lib/push-badge';

const worker = globalThis as unknown as ServiceWorkerGlobalScope;
const cacheName = `email-check-${version}`;
const assets = new Set([...build, ...files]);

worker.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(cacheName)
      .then((cache) => cache.addAll(assets))
      .then(() => worker.skipWaiting())
  );
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== cacheName) await caches.delete(key);
      }
      await worker.clients.claim();
    })()
  );
});

worker.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== worker.location.origin || url.pathname.startsWith('/api/')) return;

  if (assets.has(url.pathname)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request));
  }
});

// iOS can cancel the subscription if a push does not show a notification.
worker.addEventListener('push', (event) => {
  const payload = (event.data?.json() ?? {}) as Partial<PushPayload>;
  event.waitUntil(
    (async () => {
      await worker.registration.showNotification(payload.title ?? 'New email', {
        body: payload.body,
        tag: payload.tag,
        data: { url: payload.url ?? '/' },
        icon: '/icons/email-check-192.png',
      });
      try {
        await worker.navigator.setAppBadge?.(await incrementBadgeCount());
      } catch (error) {
        console.error('The app badge was not updated.', error);
      }
    })()
  );
});

worker.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data as { url?: string } | null)?.url ?? '/',
    worker.location.origin
  ).href;
  event.waitUntil(
    (async () => {
      const [client] = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (client) {
        await client.focus();
        await client.navigate(url);
      } else {
        await worker.clients.openWindow(url);
      }
    })()
  );
});

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(cacheName);
  return (await cache.match(request)) ?? fetch(request);
}

async function networkFirst(request: Request): Promise<Response> {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok && !response.headers.get('cache-control')?.includes('no-store')) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}
