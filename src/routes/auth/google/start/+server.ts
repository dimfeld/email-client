import { randomBytes } from 'node:crypto';
import { redirect } from '@sveltejs/kit';
import { createGoogleAuthorizationRequest } from '$lib/server/google-api';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
  const state = randomBytes(32).toString('base64url');
  const { url, codeVerifier } = await createGoogleAuthorizationRequest(state);
  cookies.set('google_oauth_state', state, {
    path: '/auth/google',
    httpOnly: true,
    sameSite: 'lax',
  });
  cookies.set('google_oauth_code_verifier', codeVerifier, {
    path: '/auth/google',
    httpOnly: true,
    sameSite: 'lax',
  });
  redirect(303, url);
};
