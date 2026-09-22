import { readFileSync } from 'node:fs';
import { OAuth2Client } from 'google-auth-library';
import { getDatabase, listAccounts, setAccountHistoryId } from '../src/lib/server/db';
import { createGoogleOAuthClient, googleApiRequest } from '../src/lib/server/google-api';
import { readFlag, requireFlag } from './shared';

const email = requireFlag('--account');
const oauthFile = readFlag('--oauth-file');
const account = listAccounts(getDatabase()).find((candidate) => candidate.email === email);
if (!account) throw new Error(`Configure ${email} before starting its watch.`);
if (!account.topic) throw new Error(`Configure a Pub/Sub topic for ${email} first.`);

let result: { historyId?: unknown };
if (oauthFile) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(oauthFile, 'utf8'));
  } catch (error) {
    throw new Error(
      `Could not read OAuth JSON file: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('OAuth JSON file must contain an object.');
  }
  const root = parsed as Record<string, unknown>;
  const credentialsValue = root.installed ?? root.web ?? root;
  if (
    !credentialsValue ||
    typeof credentialsValue !== 'object' ||
    Array.isArray(credentialsValue)
  ) {
    throw new Error('OAuth JSON file must contain OAuth client credentials or a refresh_token.');
  }
  const credentials = credentialsValue as Record<string, unknown>;
  const refreshToken = root.refresh_token ?? credentials.refresh_token ?? account.refreshToken;
  if (typeof refreshToken !== 'string' || !refreshToken) {
    throw new Error(
      `OAuth JSON file has no refresh_token and ${email} has no saved refresh token. Connect this account through Settings or add refresh_token to the JSON file.`
    );
  }
  const clientId = credentials.client_id;
  const clientSecret = credentials.client_secret;
  if ((clientId === undefined) !== (clientSecret === undefined)) {
    throw new Error(
      'OAuth JSON file must contain both client_id and client_secret when either is provided.'
    );
  }
  let client: OAuth2Client;
  if (
    typeof clientId === 'string' &&
    typeof clientSecret === 'string' &&
    clientId &&
    clientSecret
  ) {
    if (
      credentials.token_uri !== undefined &&
      credentials.token_uri !== 'https://oauth2.googleapis.com/token'
    ) {
      throw new Error('OAuth JSON file has an unsupported token_uri.');
    }
    client = new OAuth2Client(clientId, clientSecret);
  } else {
    client = createGoogleOAuthClient();
  }
  client.setCredentials({ refresh_token: refreshToken });
  const response = await client.request<{ historyId?: unknown }>({
    url: 'https://gmail.googleapis.com/gmail/v1/users/me/watch',
    method: 'POST',
    data: { topicName: account.topic, labelIds: ['INBOX'], labelFilterBehavior: 'include' },
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
      data: { topicName: account.topic, labelIds: ['INBOX'], labelFilterBehavior: 'include' },
    }
  );
}
const historyId = result.historyId;
if (typeof historyId !== 'string' || !/^\d+$/.test(historyId)) {
  throw new Error('Google did not return a valid historyId.');
}

setAccountHistoryId(getDatabase(), email, historyId);
console.log(`Started Gmail watch for ${email} at history ID ${historyId}.`);
