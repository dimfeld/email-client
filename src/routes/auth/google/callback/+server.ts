import { error, redirect } from '@sveltejs/kit';
import { getDatabase, listAccounts, upsertAccount } from '$lib/server/db';
import { exchangeGoogleAuthorizationCode } from '$lib/server/google-api';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
  const state = url.searchParams.get('state');
  const expectedState = cookies.get('google_oauth_state');
  const codeVerifier = cookies.get('google_oauth_code_verifier');
  cookies.delete('google_oauth_state', { path: '/auth/google' });
  cookies.delete('google_oauth_code_verifier', { path: '/auth/google' });
  if (!state || !expectedState || state !== expectedState)
    error(400, 'The Google OAuth state is invalid. Start the connection again.');
  const code = url.searchParams.get('code');
  if (!code)
    error(
      400,
      url.searchParams.get('error_description') ?? 'Google did not return an authorization code.'
    );
  const credential = await exchangeGoogleAuthorizationCode(code, codeVerifier ?? undefined);
  const existing = listAccounts(getDatabase()).find(
    (account) => account.email === credential.email
  );
  if (!credential.refreshToken && !existing?.refreshToken) {
    error(
      400,
      'Google did not return a refresh token. Remove the app from your Google account permissions, then connect it again.'
    );
  }
  upsertAccount(getDatabase(), {
    email: credential.email,
    displayName: credential.name,
    refreshToken: credential.refreshToken ?? undefined,
  });
  redirect(303, '/settings?google=connected');
};
