export const composerSchema = `
CREATE TABLE IF NOT EXISTS email_drafts (
 id TEXT PRIMARY KEY,
 account_email TEXT NOT NULL REFERENCES accounts(email),
 to_addresses TEXT NOT NULL DEFAULT '', cc_addresses TEXT NOT NULL DEFAULT '', bcc_addresses TEXT NOT NULL DEFAULT '',
 subject TEXT NOT NULL DEFAULT '', body_html TEXT NOT NULL DEFAULT '', body_text TEXT NOT NULL DEFAULT '',
 mode TEXT NOT NULL, source_email_id INTEGER REFERENCES emails(id) ON DELETE SET NULL,
 version INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','queued','sending','sent','failed','uncertain')),
 send_at INTEGER, raw_message BLOB, message_id TEXT, sent_gmail_id TEXT, error TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS draft_attachments (
 id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES email_drafts(id) ON DELETE CASCADE,
 filename TEXT NOT NULL, content_type TEXT NOT NULL, content BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drafts_outbox ON email_drafts(status, send_at);
`;
