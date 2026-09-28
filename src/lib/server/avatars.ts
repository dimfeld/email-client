import type { DatabaseSync } from 'node:sqlite';
import { getDatabase } from './db';

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

// The mail list shows avatars at up to 40 CSS pixels, which is 120 device pixels on a 3x
// phone screen. Both image sources take the size in the URL.
const avatarSize = 128;

// How long to keep a result when the response gives no max-age, including "no icon". This
// is the max-age that Google's favicon service sends for icons.
const defaultCacheMs = 7 * 24 * 60 * 60 * 1000;

// The slowest successful icon request measured took 3 seconds. Hosts that do not answer
// otherwise hold the request for about two minutes.
const fetchTimeoutMs = 10_000;

const countrySecondLevels = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org']);

const imageTypes = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/x-icon',
  'image/vnd.microsoft.icon',
];

function contactPhoto(database: DatabaseSync, account: string, address: string): string | null {
  const row = database
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
      ? // Google photo URLs end with a size such as "=s100".
        url.href.replace(/=s\d+(-c)?$/, `=s${avatarSize}$1`)
      : null;
  } catch {
    return null;
  }
}

/** The hosts to look up icons for: the sender's domain, then the domain without subdomains.
 * Returns no hosts for a domain that is not a DNS name, such as an IP address or a port. */
export function iconHosts(domain: string): string[] {
  const labels = domain.toLowerCase().split('.');
  if (
    labels.length < 2 ||
    !labels.every((label) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) ||
    !/^[a-z]{2,}$/.test(labels.at(-1)!)
  ) {
    return [];
  }
  // Keep a country second-level domain such as "co.uk" with the name before it.
  const [secondLevel, topLevel] = labels.slice(-2);
  const baseLength = topLevel.length === 2 && countrySecondLevels.has(secondLevel) ? 3 : 2;
  const base = labels.slice(-baseLength).join('.');
  return labels.length > baseLength ? [labels.join('.'), base] : [labels.join('.')];
}

/** Gets an image through the cache. Failed lookups are cached too, so each source is
 * requested at most once in each cache period. */
export async function cachedImage(
  database: DatabaseSync,
  source: string
): Promise<Response | null> {
  const cached = database
    .prepare('SELECT mime_type, image, expires_at FROM avatar_images WHERE source = ?')
    .get(source) as
    | { mime_type: string | null; image: Uint8Array | null; expires_at: number }
    | undefined;
  if (cached && cached.expires_at > Date.now()) {
    if (!cached.mime_type || !cached.image) return null;
    return imageResponse(cached.mime_type, cached.image);
  }

  let mimeType: string | null = null;
  let image: Uint8Array | null = null;
  let maxAge = 0;
  let noStore = false;
  try {
    const response = await fetch(source, { signal: AbortSignal.timeout(fetchTimeoutMs) });
    const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    const body = new Uint8Array(await response.arrayBuffer());
    if (response.ok && type && imageTypes.includes(type) && body.length > 0) {
      mimeType = type;
      image = body;
      const cacheControl = response.headers.get('cache-control') ?? '';
      maxAge = Number(cacheControl.match(/(?:^|,)\s*max-age=(\d+)/)?.[1]) || 0;
      noStore = cacheControl.includes('no-store');
    }
  } catch {
    // A host that does not answer in time has no icon.
  }
  if (!noStore) {
    const expiresAt = Date.now() + (maxAge > 0 ? maxAge * 1000 : defaultCacheMs);
    // Also remove old entries, such as images from sources the app no longer uses.
    database.prepare('DELETE FROM avatar_images WHERE expires_at <= ?').run(Date.now());
    database
      .prepare(`INSERT INTO avatar_images (source, mime_type, image, expires_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(source) DO UPDATE SET
      mime_type = excluded.mime_type, image = excluded.image, expires_at = excluded.expires_at`)
      .run(source, mimeType, image, expiresAt);
  }
  return mimeType && image ? imageResponse(mimeType, image) : null;
}

function imageResponse(mimeType: string, image: Uint8Array): Response {
  return new Response(new Uint8Array(image).buffer as ArrayBuffer, {
    headers: { 'Content-Type': mimeType, 'Cache-Control': 'private, no-cache' },
  });
}

/** Finds an avatar for a sender: a contact photo, or else an icon for the sender's domain.
 * A site's apple-touch-icon comes first, because it is usually larger than its favicon. */
export async function senderAvatar(
  account: string,
  address: string,
  database = getDatabase()
): Promise<Response | null> {
  const photoUrl = contactPhoto(database, account, address);
  if (photoUrl) {
    const photo = await cachedImage(database, photoUrl);
    if (photo) return photo;
  }
  const domain = address.split('@')[1];
  if (personalMailDomains.has(domain)) return null;
  for (const host of iconHosts(domain)) {
    const icon =
      (await cachedImage(database, `https://${host}/apple-touch-icon.png`)) ??
      (await cachedImage(
        database,
        `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${avatarSize}`
      ));
    if (icon) return icon;
  }
  return null;
}
