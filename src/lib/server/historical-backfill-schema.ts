export const historicalBackfillSchema = `
CREATE TABLE IF NOT EXISTS historical_backfills (
 id TEXT PRIMARY KEY,
 account_email TEXT NOT NULL REFERENCES accounts(email) ON DELETE CASCADE,
 query TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','running','paused','complete','failed')),
 page_token TEXT,
 pending_ids_json TEXT NOT NULL DEFAULT '[]',
 exhausted INTEGER NOT NULL DEFAULT 0,
 processed INTEGER NOT NULL DEFAULT 0,
 downloaded INTEGER NOT NULL DEFAULT 0,
 missing INTEGER NOT NULL DEFAULT 0,
 classify INTEGER NOT NULL DEFAULT 0,
 delay_ms REAL NOT NULL,
 retry_count INTEGER NOT NULL DEFAULT 0,
 next_run_at INTEGER NOT NULL,
 error TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS historical_backfill_messages (
 job_id TEXT NOT NULL REFERENCES historical_backfills(id) ON DELETE CASCADE,
 gmail_id TEXT NOT NULL,
 PRIMARY KEY(job_id, gmail_id)
);`;
