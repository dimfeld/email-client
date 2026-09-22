import { describe, expect, it } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowsRemoteImages, senderAddress, senderDomain } from './remote-images';
import {
  createDatabase,
  deleteRemoteImageRule,
  listRemoteImageRules,
  saveRemoteImageRule,
} from './server/db';

describe('remote image sender rules', () => {
  it('matches an exact sender address or domain without matching a different domain', () => {
    expect(senderAddress('"Sender" <News@Example.com>')).toBe('news@example.com');
    expect(senderDomain('"Sender" <News@Example.com>')).toBe('example.com');
    expect(
      allowsRemoteImages('News@Example.com', [{ kind: 'address', value: 'news@example.com' }])
    ).toBe(true);
    expect(
      allowsRemoteImages('other@example.com', [{ kind: 'address', value: 'news@example.com' }])
    ).toBe(false);
    expect(
      allowsRemoteImages('other@example.com', [{ kind: 'domain', value: 'example.com' }])
    ).toBe(true);
    expect(
      allowsRemoteImages('other@sub.example.com', [{ kind: 'domain', value: 'example.com' }])
    ).toBe(false);
    expect(
      allowsRemoteImages('other@notexample.com', [{ kind: 'domain', value: 'example.com' }])
    ).toBe(false);
    expect(allowsRemoteImages('No sender', [{ kind: 'domain', value: 'example.com' }])).toBe(false);
  });

  it('keeps rules after reopening SQLite and removes them', () => {
    const directory = mkdtempSync(join(tmpdir(), 'email-check-remote-images-'));
    const path = join(directory, 'test.sqlite');
    let database: DatabaseSync | undefined;
    try {
      database = createDatabase(path);
      saveRemoteImageRule(database, { kind: 'address', value: 'news@example.com' });
      saveRemoteImageRule(database, { kind: 'domain', value: 'example.com' });
      saveRemoteImageRule(database, { kind: 'domain', value: 'example.com' });
      database.close();
      database = createDatabase(path);
      expect(listRemoteImageRules(database)).toEqual([
        { kind: 'address', value: 'news@example.com' },
        { kind: 'domain', value: 'example.com' },
      ]);
      deleteRemoteImageRule(database, { kind: 'address', value: 'news@example.com' });
      expect(listRemoteImageRules(database)).toEqual([{ kind: 'domain', value: 'example.com' }]);
    } finally {
      database?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
