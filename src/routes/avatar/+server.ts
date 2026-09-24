import { getDatabase } from '$lib/server/db';
import { senderAddress } from '$lib/remote-images';
import type { DatabaseSync } from 'node:sqlite';
import type { RequestHandler } from './$types';

const personalMailDomains = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'fastmail.com',
]);

function contactPhoto(account: string, address: string): string | null {
  const row = getDatabase()
    .prepare(`SELECT photo_url FROM (
      SELECT photo_url, 0 AS priority FROM contacts
        WHERE account_email = ? AND photo_url IS NOT NULL
          AND EXISTS (SELECT 1 FROM json_each(emails_json) WHERE lower(value) = ?)
      UNION ALL
      SELECT photo_url, 1 AS priority FROM other_contacts
        WHERE account_email = ? AND photo_url IS NOT NULL
          AND EXISTS (SELECT 1 FROM json_each(emails_json) WHERE lower(value) = ?)
    ) ORDER BY priority LIMIT 1`)
    .get(account, address, account, address) as { photo_url: string } | undefined;
  if (!row) return null;
  try {
    const url = new URL(row.photo_url);
    return url.protocol === 'https:' &&
      (url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com'))
      ? url.href
      : null;
  } catch {
    return null;
  }
}

async function cachedImage(database: DatabaseSync, source: string): Promise<Response | null> {
  const cached = database
    .prepare('SELECT mime_type, image, expires_at FROM avatar_images WHERE source = ?')
    .get(source) as { mime_type: string; image: Uint8Array; expires_at: number } | undefined;
  if (cached && cached.expires_at > Date.now()) {
    return new Response(new Uint8Array(cached.image).buffer as ArrayBuffer, {
      headers: { 'Content-Type': cached.mime_type, 'Cache-Control': 'private, no-cache' },
    });
  }

  try {
    const response = await fetch(source);
    const mimeType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (
      !response.ok ||
      !mimeType ||
      ![
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/gif',
        'image/x-icon',
        'image/vnd.microsoft.icon',
      ].includes(mimeType)
    ) {
      return null;
    }
    const image = new Uint8Array(await response.arrayBuffer());
    const maxAge = Number(
      response.headers.get('cache-control')?.match(/(?:^|,)\s*max-age=(\d+)/)?.[1]
    );
    if (!response.headers.get('cache-control')?.includes('no-store') && maxAge > 0) {
      database
        .prepare(`INSERT INTO avatar_images (source, mime_type, image, expires_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(source) DO UPDATE SET
        mime_type = excluded.mime_type, image = excluded.image, expires_at = excluded.expires_at`)
        .run(source, mimeType, image, Date.now() + maxAge * 1000);
    }
    return new Response(image, {
      headers: { 'Content-Type': mimeType, 'Cache-Control': 'private, no-cache' },
    });
  } catch {
    return null;
  }
}

export const GET: RequestHandler = async ({ url }) => {
  const account = url.searchParams.get('account');
  const address = senderAddress(url.searchParams.get('from') ?? '');
  if (!account || !address) return new Response(null, { status: 404 });

  const database = getDatabase();
  const photoUrl = contactPhoto(account, address);
  if (photoUrl) {
    const photo = await cachedImage(database, photoUrl);
    if (photo) return photo;
  }
  const domain = address.split('@')[1];
  if (personalMailDomains.has(domain)) return new Response(null, { status: 404 });
  const iconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
  return (await cachedImage(database, iconUrl)) ?? new Response(null, { status: 404 });
};
