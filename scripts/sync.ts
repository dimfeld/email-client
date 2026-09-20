import { createJevClassifier } from '../src/lib/server/classifier';
import { getDatabase } from '../src/lib/server/db';
import { createOpenAIEmailExtractor } from '../src/lib/server/extractor';
import { ingestGmailPayload } from '../src/lib/server/ingest';
import { normalizeSearchMessage, readFlag, requireFlag, runJson } from './shared';

const account = requireFlag('--account');
const query = requireFlag('--query');
const limit = readFlag('--limit');
const result = (await runJson([
	'gog',
	'gmail',
	'messages',
	'search',
	query,
	'--account',
	account,
	...(limit ? ['--max', limit] : []),
	'--json',
	'--all',
	'--include-body'
])) as { messages?: unknown[] };
const messages = (result.messages ?? []).map(normalizeSearchMessage);
const ingested = await ingestGmailPayload(
	getDatabase(),
	{ source: 'gmail', account, deletedMessageIds: [], messages },
	createJevClassifier(),
	createOpenAIEmailExtractor()
);

console.log(`Stored ${ingested.stored} and classified ${ingested.classified} message(s).`);
