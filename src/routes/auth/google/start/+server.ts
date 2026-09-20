import { randomBytes } from 'node:crypto';
import { redirect } from '@sveltejs/kit';
import { createGoogleAuthorizationUrl } from '$lib/server/google-api';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ cookies }) => {
	const state = randomBytes(32).toString('base64url');
	cookies.set('google_oauth_state', state, { path: '/auth/google', httpOnly: true, sameSite: 'lax' });
	redirect(303, createGoogleAuthorizationUrl(state));
};
