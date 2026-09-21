import { readFileSync } from 'node:fs';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import type { IncomingEmail } from './types';

export const GOOGLE_OAUTH_SCOPES = [
	'https://www.googleapis.com/auth/gmail.modify',
	'https://www.googleapis.com/auth/contacts.readonly',
	'https://www.googleapis.com/auth/calendar.readonly',
	'https://www.googleapis.com/auth/userinfo.email'
];

export type GoogleAccount = { email: string; refreshToken: string | null };

export class GoogleApiError extends Error {
	constructor(message: string, readonly status: number | undefined) {
		super(message);
	}
}

type OAuthClientCredentials = {
	client_id?: unknown;
	client_secret?: unknown;
	auth_uri?: unknown;
	token_uri?: unknown;
};

function oauthConfiguration() {
	const clientFile = process.env.GOOGLE_OAUTH_CLIENT_FILE;
	if (clientFile) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(readFileSync(clientFile, 'utf8'));
		} catch (error) {
			throw new Error(`Could not read GOOGLE_OAUTH_CLIENT_FILE: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (!parsed || typeof parsed !== 'object') throw new Error('GOOGLE_OAUTH_CLIENT_FILE must contain a Google OAuth client JSON object.');
		const credentials = (parsed as { installed?: OAuthClientCredentials; web?: OAuthClientCredentials }).installed
			?? (parsed as { installed?: OAuthClientCredentials; web?: OAuthClientCredentials }).web;
		const clientId = credentials?.client_id;
		const clientSecret = credentials?.client_secret;
		if (typeof clientId !== 'string' || typeof clientSecret !== 'string' || !clientId || !clientSecret) {
			throw new Error('GOOGLE_OAUTH_CLIENT_FILE must contain installed or web client_id and client_secret values.');
		}
		if (credentials?.auth_uri !== undefined && credentials.auth_uri !== 'https://accounts.google.com/o/oauth2/auth') {
			throw new Error('GOOGLE_OAUTH_CLIENT_FILE has an unsupported OAuth authorization endpoint.');
		}
		if (credentials?.token_uri !== undefined && credentials.token_uri !== 'https://oauth2.googleapis.com/token') {
			throw new Error('GOOGLE_OAUTH_CLIENT_FILE has an unsupported OAuth token endpoint.');
		}
		return {
			clientId,
			clientSecret,
			redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI ?? 'http://127.0.0.1:3000/auth/google/callback'
		};
	}
	const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
	const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error('Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET before connecting Google accounts.');
	}
	return {
		clientId,
		clientSecret,
		redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI ?? 'http://127.0.0.1:3000/auth/google/callback'
	};
}

export function createGoogleOAuthClient(): OAuth2Client {
	const config = oauthConfiguration();
	return new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
}

export async function createGoogleAuthorizationRequest(state: string): Promise<{ url: string; codeVerifier: string }> {
	const client = createGoogleOAuthClient();
	const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
	return {
		url: client.generateAuthUrl({
			access_type: 'offline',
			code_challenge: codeChallenge,
			code_challenge_method: CodeChallengeMethod.S256,
			include_granted_scopes: true,
			prompt: 'consent',
			scope: GOOGLE_OAUTH_SCOPES,
			state
		}),
		codeVerifier
	};
}

export async function exchangeGoogleAuthorizationCode(code: string, codeVerifier?: string): Promise<{ email: string; refreshToken: string | null }> {
	const client = createGoogleOAuthClient();
	const { tokens } = await client.getToken({ code, codeVerifier });
	client.setCredentials(tokens);
	const response = await client.request<{ email?: string }>({ url: 'https://www.googleapis.com/oauth2/v2/userinfo' });
	if (!response.data.email) throw new Error('Google did not return the account email address.');
	return { email: response.data.email, refreshToken: tokens.refresh_token ?? null };
}

function messageFromError(error: unknown): { message: string; status: number | undefined } {
	if (!error || typeof error !== 'object') return { message: String(error), status: undefined };
	const value = error as { message?: unknown; response?: { status?: unknown; data?: unknown } };
	const status = typeof value.response?.status === 'number' ? value.response.status : undefined;
	const data = value.response?.data;
	let message = typeof value.message === 'string' ? value.message : 'Google API request failed.';
	if (data && typeof data === 'object') {
		const apiMessage = (data as { error?: { message?: unknown } }).error?.message;
		if (typeof apiMessage === 'string') message = apiMessage;
	}
	return { message, status };
}

export async function googleApiRequest<T>(
	account: GoogleAccount,
	url: string,
	options: { method?: string; params?: Record<string, string | number | boolean | undefined>; data?: unknown } = {}
): Promise<T> {
	if (!account.refreshToken) throw new Error(`${account.email} is not connected to Google OAuth.`);
	const client = createGoogleOAuthClient();
	client.setCredentials({ refresh_token: account.refreshToken });
	try {
		const response = await client.request<T>({ url, method: options.method, params: options.params, data: options.data });
		return response.data;
	} catch (error) {
		const details = messageFromError(error);
		throw new GoogleApiError(details.message, details.status);
	}
}

type GmailPart = {
	mimeType?: string;
	headers?: Array<{ name?: string; value?: string }>;
	body?: { data?: string };
	parts?: GmailPart[];
};

function header(part: GmailPart, name: string): string | undefined {
	return part.headers?.find((item) => item.name?.toLowerCase() === name)?.value;
}

function isAttachment(part: GmailPart): boolean {
	return /^attachment(?:;|$)/i.test(header(part, 'content-disposition')?.trim() ?? '');
}

function mimeBody(part: GmailPart, type: 'text/plain' | 'text/html'): string | undefined {
	if (isAttachment(part)) return undefined;
	if (part.mimeType === type && part.body?.data) return Buffer.from(part.body.data, 'base64url').toString('utf8');
	for (const child of part.parts ?? []) {
		const body = mimeBody(child, type);
		if (body !== undefined) return body;
	}
}

export function normalizeGmailMessage(value: unknown): IncomingEmail {
	if (!value || typeof value !== 'object') throw new Error('Google returned an invalid Gmail message.');
	const message = value as { id?: unknown; threadId?: unknown; labelIds?: unknown; snippet?: unknown; internalDate?: unknown; payload?: GmailPart };
	if (typeof message.id !== 'string') throw new Error('A Gmail message did not include an id.');
	const payload = message.payload ?? {};
	return {
		id: message.id,
		threadId: typeof message.threadId === 'string' ? message.threadId : undefined,
		from: header(payload, 'from'),
		to: header(payload, 'to'),
		subject: header(payload, 'subject'),
		date: header(payload, 'date') ?? (typeof message.internalDate === 'string' ? message.internalDate : undefined),
		snippet: typeof message.snippet === 'string' ? message.snippet : undefined,
		bodyText: mimeBody(payload, 'text/plain'),
		bodyHtml: mimeBody(payload, 'text/html'),
		bodyTruncated: false,
		labels: Array.isArray(message.labelIds) ? message.labelIds.filter((item): item is string => typeof item === 'string') : []
	};
}

export async function listGmailMessages(account: GoogleAccount, query: string, maxMessages?: number): Promise<IncomingEmail[]> {
	const ids: string[] = [];
	let pageToken: string | undefined;
	do {
		const result = await googleApiRequest<{ messages?: Array<{ id?: string }>; nextPageToken?: string }>(
			account, 'https://gmail.googleapis.com/gmail/v1/users/me/messages',
			{ params: { q: query, maxResults: 500, pageToken } }
		);
		ids.push(...(result.messages ?? []).flatMap((message) => message.id ? [message.id] : []));
		if (maxMessages !== undefined && ids.length >= maxMessages) break;
		pageToken = result.nextPageToken;
	} while (pageToken);
	const messages: IncomingEmail[] = [];
	for (const id of maxMessages === undefined ? ids : ids.slice(0, maxMessages)) messages.push(await getGmailMessage(account, id));
	return messages;
}

export async function getGmailMessage(account: GoogleAccount, id: string): Promise<IncomingEmail> {
	return normalizeGmailMessage(await googleApiRequest(account,
		`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`,
		{ params: { format: 'full' } }));
}
