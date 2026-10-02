import { expect, test } from 'bun:test';
import { createDatabase, upsertAccount } from './db';
import {
  loadGmailHistoryDownload,
  loadGmailHistoryProgress,
  saveGmailHistoryDownload,
  saveGmailHistoryProgress,
  type GmailHistoryChange,
} from './gmail-history-progress';

test('repairs saved fallback flags without discarding downloads or changing cursors', () => {
  const database = createDatabase(':memory:');
  try {
    upsertAccount(database, { email: 'one@example.com', refreshToken: 'one' });
    upsertAccount(database, { email: 'two@example.com', refreshToken: 'two' });
    const changes: GmailHistoryChange[] = [
      { id: 'archived', added: false, deleted: false, fetch: true, labels: { INBOX: false } },
      { id: 'added', added: true, deleted: false, fetch: true, labels: {} },
      { id: 'deleted', added: false, deleted: true, fetch: true, labels: {} },
      { id: 'generic', added: false, deleted: false, fetch: true, labels: {} },
    ];
    const progress = { startHistoryId: '100', historyId: '105', changes };
    saveGmailHistoryProgress(database, 'one@example.com', progress);
    saveGmailHistoryProgress(database, 'two@example.com', progress);
    const downloaded = { id: 'generic', labels: ['INBOX'], bodyText: 'Saved contents.' };
    saveGmailHistoryDownload(database, 'one@example.com', 'generic', downloaded);
    saveGmailHistoryDownload(database, 'one@example.com', 'missing', null);

    const repaired = loadGmailHistoryProgress(database, 'one@example.com', '100')!;
    expect(repaired.changes.map((change) => change.fetch)).toEqual([false, false, false, true]);
    expect(repaired.startHistoryId).toBe('100');
    expect(repaired.historyId).toBe('105');
    const saved = database.prepare(
      'SELECT changes_json FROM gmail_history_progress WHERE account_email = ?'
    );
    expect(JSON.parse(String(saved.get('one@example.com')!.changes_json))).toEqual(
      repaired.changes
    );
    expect(JSON.parse(String(saved.get('two@example.com')!.changes_json))).toEqual(changes);
    expect(loadGmailHistoryDownload(database, 'one@example.com', 'generic')).toEqual(downloaded);
    expect(loadGmailHistoryDownload(database, 'one@example.com', 'missing')).toBeNull();
  } finally {
    database.close();
  }
});
