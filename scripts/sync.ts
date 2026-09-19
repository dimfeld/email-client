import { createJevClassifier } from '../src/lib/server/classifier';
import { getDatabase } from '../src/lib/server/db';
import { ingestGmailPayload } from '../src/lib/server/ingest';
import { normalizeSearchMessage, requireFlag, runJson } from './shared';

const account = requireFlag('--account');
const query = requireFlag('--query');
const result = (await runJson([
	'gog',
	'gmail',
	'messages',
	'search',
	query,
	'--account',
	account,
	'--json',
	'--all',
	'--include-body'
])) as { messages?: unknown[] };
const messages = (result.messages ?? []).map(normalizeSearchMessage);
const ingested = await ingestGmailPayload(
	getDatabase(),
	{ source: 'gmail', account, deletedMessageIds: [], messages },
	createJevClassifier()
);

console.log(`Stored ${ingested.stored} and classified ${ingested.classified} message(s).`);
