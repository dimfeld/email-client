import { createJevClassifier } from '../src/lib/server/classifier';
import { getDatabase, listAccounts } from '../src/lib/server/db';
import { createOpenAIEmailExtractor } from '../src/lib/server/extractor';
import { ingestGmailPayload } from '../src/lib/server/ingest';
import { listGmailMessages } from '../src/lib/server/google-api';
import { readFlag, requireFlag } from './shared';

const account = requireFlag('--account');
const query = requireFlag('--query');
const limit = readFlag('--limit');
const configuredAccount = listAccounts(getDatabase()).find((candidate) => candidate.email === account);
if (!configuredAccount?.refreshToken) throw new Error(`Connect ${account} through Settings before importing mail.`);
const maxMessages = limit === undefined ? undefined : Number(limit);
if (maxMessages !== undefined && (!Number.isInteger(maxMessages) || maxMessages <= 0)) throw new Error('--limit must be a positive integer.');
const messages = await listGmailMessages(configuredAccount, query, maxMessages);
const ingested = await ingestGmailPayload(
	getDatabase(),
	{ source: 'gmail', account, deletedMessageIds: [], messages },
	createJevClassifier(),
	createOpenAIEmailExtractor()
);

console.log(`Stored ${ingested.stored} and classified ${ingested.classified} message(s).`);
