import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWatchOAuthClient } from './watch-oauth';

let directory: string | undefined;

afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('watch OAuth JSON', () => {
  it('uses client credentials and the refresh token from the file', () => {
    directory = mkdtempSync(join(tmpdir(), 'watch-oauth-'));
    const path = join(directory, 'oauth.json');
    writeFileSync(
      path,
      JSON.stringify({
        installed: { client_id: 'file-client', client_secret: 'file-secret' },
        refresh_token: 'file-token',
      })
    );

    const client = createWatchOAuthClient(path, 'one@example.com', 'saved-token');

    expect(client._clientId).toBe('file-client');
    expect(client.credentials.refresh_token).toBe('file-token');
  });

  it('uses the saved refresh token when the file has only client credentials', () => {
    directory = mkdtempSync(join(tmpdir(), 'watch-oauth-'));
    const path = join(directory, 'oauth.json');
    writeFileSync(
      path,
      JSON.stringify({ web: { client_id: 'file-client', client_secret: 'secret' } })
    );

    const client = createWatchOAuthClient(path, 'one@example.com', 'saved-token');

    expect(client.credentials.refresh_token).toBe('saved-token');
  });
});
