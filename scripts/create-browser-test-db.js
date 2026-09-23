import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const outputPath = process.argv[2];
if (!outputPath) throw new Error('Usage: bun run scripts/create-browser-test-db.js OUTPUT_PATH');

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(projectRoot, 'data/email-check.sqlite');
const destination = resolve(outputPath);
if (destination === sourcePath) throw new Error('Output path must not be the production database.');
if (!existsSync(sourcePath)) throw new Error(`Source database does not exist: ${sourcePath}`);
if (existsSync(destination)) throw new Error(`Output database already exists: ${destination}`);

mkdirSync(dirname(destination), { recursive: true });
const temporaryCopy = `${destination}.${randomUUID()}.tmp`;

try {
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    source.prepare('VACUUM INTO ?').run(temporaryCopy);
  } finally {
    source.close();
  }

  const copy = new DatabaseSync(temporaryCopy);
  try {
    copy.exec('BEGIN');
    copy.exec(`
      UPDATE accounts
      SET google_refresh_token = NULL, subscription = NULL, topic = NULL;
      UPDATE email_drafts SET status = 'draft' WHERE status IN ('queued', 'sending');
    `);
    copy.exec('COMMIT');
  } catch (error) {
    copy.exec('ROLLBACK');
    throw error;
  } finally {
    copy.close();
  }

  renameSync(temporaryCopy, destination);
  console.log(`Created scrubbed browser test database: ${destination}`);
} finally {
  if (existsSync(temporaryCopy)) rmSync(temporaryCopy);
}
