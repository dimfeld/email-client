export const snoozeSchema = `
CREATE TABLE IF NOT EXISTS snoozes (
 id INTEGER PRIMARY KEY,
 account_email TEXT NOT NULL REFERENCES accounts(email) ON DELETE CASCADE,
 thread_key TEXT NOT NULL,
 email_ids_json TEXT NOT NULL,
 wake_at INTEGER NOT NULL,
 retry_count INTEGER NOT NULL DEFAULT 0,
 error TEXT,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS snoozes_wake ON snoozes(wake_at);`;
