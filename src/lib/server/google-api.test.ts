import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGoogleAuthorizationRequest, normalizeGmailMessage } from './google-api';

const originalOAuthEnvironment = {
	clientFile: process.env.GOOGLE_OAUTH_CLIENT_FILE,
	clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
	clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
	redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI
};

afterEach(() => {
	for (const [name, value] of Object.entries({
		GOOGLE_OAUTH_CLIENT_FILE: originalOAuthEnvironment.clientFile,
		GOOGLE_OAUTH_CLIENT_ID: originalOAuthEnvironment.clientId,
		GOOGLE_OAUTH_CLIENT_SECRET: originalOAuthEnvironment.clientSecret,
		GOOGLE_OAUTH_REDIRECT_URI: originalOAuthEnvironment.redirectUri
	})) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
});

describe('Google OAuth setup', () => {
	it('loads a downloaded OAuth client file and creates a loopback PKCE request', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'email-check-google-oauth-'));
		try {
			const clientFile = join(directory, 'client_secret.json');
			writeFileSync(clientFile, JSON.stringify({
				installed: {
					client_id: 'desktop-client.apps.googleusercontent.com',
					client_secret: 'desktop-secret'
				}
			}));
			process.env.GOOGLE_OAUTH_CLIENT_FILE = clientFile;
			delete process.env.GOOGLE_OAUTH_CLIENT_ID;
			delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
			delete process.env.GOOGLE_OAUTH_REDIRECT_URI;

			const request = await createGoogleAuthorizationRequest('state-value');
			const params = new URL(request.url).searchParams;
			expect(params.get('client_id')).toBe('desktop-client.apps.googleusercontent.com');
			expect(params.get('redirect_uri')).toBe('http://127.0.0.1:3000/auth/google/callback');
			expect(params.get('code_challenge_method')).toBe('S256');
			expect(params.get('code_challenge')).toBeTruthy();
			expect(request.codeVerifier).toBeTruthy();
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});

describe('Google Gmail message normalization', () => {
	it('decodes plain text and HTML MIME bodies and skips attachments', () => {
		const message = normalizeGmailMessage({
			id: 'message-1', threadId: 'thread-1', labelIds: ['INBOX'], snippet: 'Preview',
			payload: {
				headers: [
					{ name: 'From', value: 'Sender <sender@example.com>' },
					{ name: 'To', value: 'owner@example.com' },
					{ name: 'Subject', value: 'Hello' },
					{ name: 'Date', value: 'Fri, 18 Sep 2026 12:00:00 +0000' }
				],
				parts: [
					{ mimeType: 'text/plain', body: { data: Buffer.from('Plain body').toString('base64url') } },
					{ mimeType: 'text/html', body: { data: Buffer.from('<p>HTML body</p>').toString('base64url') } },
					{ mimeType: 'text/plain', headers: [{ name: 'Content-Disposition', value: 'attachment; filename=x.txt' }], body: { data: Buffer.from('Attachment').toString('base64url') } }
				]
			}
		});

		expect(message).toMatchObject({
			id: 'message-1', threadId: 'thread-1', from: 'Sender <sender@example.com>',
			to: 'owner@example.com', subject: 'Hello', bodyText: 'Plain body', bodyHtml: '<p>HTML body</p>', labels: ['INBOX']
		});
	});
});
