import { getDatabase, listAccounts, setAccountHistoryId } from '../src/lib/server/db';
import { googleApiRequest } from '../src/lib/server/google-api';
import { readFlag, requireFlag } from './shared';
import { createWatchOAuthClient } from './watch-oauth';

const email = requireFlag('--account');
const oauthFile = readFlag('--oauth-file');
const account = listAccounts(getDatabase()).find((candidate) => candidate.email === email);
if (!account) throw new Error(`Configure ${email} before starting its watch.`);
if (!account.topic) throw new Error(`Configure a Pub/Sub topic for ${email} first.`);

let result: { historyId?: unknown };
if (oauthFile) {
  const client = createWatchOAuthClient(oauthFile, email, account.refreshToken);
  const response = await client.request<{ historyId?: unknown }>({
    url: 'https://gmail.googleapis.com/gmail/v1/users/me/watch',
    method: 'POST',
    data: { topicName: account.topic },
  });
  result = response.data;
} else {
  if (!account.refreshToken)
    throw new Error(
      `Connect ${email} through Settings or provide --oauth-file before starting its watch.`
    );
  result = await googleApiRequest<{ historyId?: unknown }>(
    account,
    'https://gmail.googleapis.com/gmail/v1/users/me/watch',
    {
      method: 'POST',
      data: { topicName: account.topic },
    }
  );
}
const historyId = result.historyId;
if (typeof historyId !== 'string' || !/^\d+$/.test(historyId)) {
  throw new Error('Google did not return a valid historyId.');
}

setAccountHistoryId(getDatabase(), email, historyId);
console.log(`Started Gmail watch for ${email} at history ID ${historyId}.`);
