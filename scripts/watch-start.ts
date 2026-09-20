import { getDatabase, listAccounts, setAccountHistoryId } from '../src/lib/server/db';
import { googleApiRequest } from '../src/lib/server/google-api';
import { requireFlag } from './shared';

const email = requireFlag('--account');
const account = listAccounts(getDatabase()).find((candidate) => candidate.email === email);
if (!account?.refreshToken) throw new Error(`Connect ${email} through Settings before starting its watch.`);
if (!account.topic) throw new Error(`Configure a Pub/Sub topic for ${email} first.`);

const result = await googleApiRequest<{ historyId?: unknown }>(account,
	'https://gmail.googleapis.com/gmail/v1/users/me/watch', {
		method: 'POST', data: { topicName: account.topic, labelIds: ['INBOX'], labelFilterBehavior: 'include' }
	});
const historyId = result.historyId;
if (typeof historyId !== 'string' || !/^\d+$/.test(historyId)) {
	throw new Error('Google did not return a valid historyId.');
}

setAccountHistoryId(getDatabase(), email, historyId);
console.log(`Started Gmail watch for ${email} at history ID ${historyId}.`);
