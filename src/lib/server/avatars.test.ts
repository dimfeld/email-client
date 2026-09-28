import { afterEach, expect, test } from 'bun:test';
import { cachedImage, iconHosts, senderAvatar } from './avatars';
import { createDatabase } from './db';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(handler: (url: string) => Response) {
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    return handler(url);
  }) as typeof fetch;
  return requests;
}

const png = () =>
  new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
    headers: { 'Content-Type': 'image/png' },
  });

test('iconHosts falls back from a subdomain to the base domain', () => {
  expect(iconHosts('notice.aliexpress.com')).toEqual(['notice.aliexpress.com', 'aliexpress.com']);
  expect(iconHosts('a.b.example.com')).toEqual(['a.b.example.com', 'example.com']);
  expect(iconHosts('github.com')).toEqual(['github.com']);
  expect(iconHosts('mail.bbc.co.uk')).toEqual(['mail.bbc.co.uk', 'bbc.co.uk']);
  expect(iconHosts('bbc.co.uk')).toEqual(['bbc.co.uk']);
  expect(iconHosts('mail.x.ai')).toEqual(['mail.x.ai', 'x.ai']);
});

test('iconHosts rejects domains that are not DNS names', () => {
  expect(iconHosts('127.0.0.1')).toEqual([]);
  expect(iconHosts('localhost')).toEqual([]);
  expect(iconHosts('example.com:8080')).toEqual([]);
  expect(iconHosts('example.com/path')).toEqual([]);
});

test('cachedImage caches a failed lookup', async () => {
  const database = createDatabase(':memory:');
  const requests = mockFetch(() => new Response('Not found', { status: 404 }));
  expect(await cachedImage(database, 'https://example.com/icon.png')).toBeNull();
  expect(await cachedImage(database, 'https://example.com/icon.png')).toBeNull();
  expect(requests).toHaveLength(1);
});

test('cachedImage caches a request that fails, such as a timeout', async () => {
  const database = createDatabase(':memory:');
  const requests = mockFetch(() => {
    throw new DOMException('The operation timed out.', 'TimeoutError');
  });
  expect(await cachedImage(database, 'https://example.com/icon.png')).toBeNull();
  expect(await cachedImage(database, 'https://example.com/icon.png')).toBeNull();
  expect(requests).toHaveLength(1);
});

test('cachedImage caches an image that has no max-age', async () => {
  const database = createDatabase(':memory:');
  const requests = mockFetch(png);
  expect((await cachedImage(database, 'https://example.com/icon.png'))?.status).toBe(200);
  const cached = await cachedImage(database, 'https://example.com/icon.png');
  expect(cached?.headers.get('content-type')).toBe('image/png');
  expect(requests).toHaveLength(1);
});

test('cachedImage removes expired entries', async () => {
  const database = createDatabase(':memory:');
  database
    .prepare('INSERT INTO avatar_images (source, mime_type, image, expires_at) VALUES (?, ?, ?, ?)')
    .run('https://old.example.com/icon.png', 'image/png', new Uint8Array([1]), Date.now() - 1);
  mockFetch(png);
  await cachedImage(database, 'https://example.com/icon.png');
  expect(
    database
      .prepare('SELECT source FROM avatar_images')
      .all()
      .map((row) => row.source)
  ).toEqual(['https://example.com/icon.png']);
});

test('senderAvatar tries the apple-touch-icon, then the favicon, then the base domain', async () => {
  const database = createDatabase(':memory:');
  const requests = mockFetch((url) =>
    url.includes('domain=aliexpress.com') ? png() : new Response(null, { status: 404 })
  );
  const avatar = await senderAvatar('me@test.com', 'deals@notice.aliexpress.com', database);
  expect(avatar?.status).toBe(200);
  expect(requests).toEqual([
    'https://notice.aliexpress.com/apple-touch-icon.png',
    'https://www.google.com/s2/favicons?domain=notice.aliexpress.com&sz=128',
    'https://aliexpress.com/apple-touch-icon.png',
    'https://www.google.com/s2/favicons?domain=aliexpress.com&sz=128',
  ]);
});
