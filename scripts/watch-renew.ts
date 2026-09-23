import { getDatabase, listAccounts } from '../src/lib/server/db';
import { renewGmailWatches } from '../src/lib/server/gmail-watch-renewal';
import { readFlag } from './shared';
import { createWatchOAuthClient } from './watch-oauth';

const accountEmail = readFlag('--account');
const oauthFile = readFlag('--oauth-file');
if (oauthFile && !accountEmail) throw new Error('Use --account with --oauth-file.');
const database = getDatabase();
const account = accountEmail
  ? listAccounts(database).find((candidate) => candidate.email === accountEmail)
  : undefined;
if (accountEmail && !account)
  throw new Error(`Configure ${accountEmail} before renewing its watch.`);
if (account && !account.enabled) throw new Error(`${accountEmail} is disabled.`);
if (account && !account.topic)
  throw new Error(`Configure a Pub/Sub topic for ${accountEmail} first.`);
if (account && !account.refreshToken && !oauthFile) {
  throw new Error(`Connect ${accountEmail} through Settings or provide --oauth-file.`);
}

const client = oauthFile
  ? createWatchOAuthClient(oauthFile, accountEmail!, account!.refreshToken)
  : null;
const request = client
  ? async <T>(_account: unknown, url: string, options: { method?: string; data?: unknown } = {}) =>
      (await client.request<T>({ url, method: options.method, data: options.data })).data
  : undefined;
const result = await renewGmailWatches(database, request, accountEmail);
console.log(`Renewed ${result.renewed} Gmail watch(es); ${result.failed} failed.`);
if (result.failed > 0) process.exitCode = 1;
