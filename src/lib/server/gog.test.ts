import { describe, expect, it } from 'bun:test';
import { normalizeGetMessage, normalizeSearchMessage, runGogJson } from './gog';

function encoded(value: string) {
	return Buffer.from(value).toString('base64url');
}

describe('gog message normalization', () => {
	it('stores search bodies in the requested representation', () => {
		expect(normalizeSearchMessage({ id: 'message', body: 'Plain text' }, 'text')).toMatchObject({
			bodyText: 'Plain text',
			bodyHtml: undefined
		});
		expect(normalizeSearchMessage({ id: 'message', body: '<p>HTML</p>' }, 'html')).toMatchObject({
			bodyText: undefined,
			bodyHtml: '<p>HTML</p>'
		});
		expect(normalizeSearchMessage({ id: 'message', body: 'Plain fallback' }, 'html').bodyHtml).toBeUndefined();
	});

	it('extracts plain text and HTML from a nested Gmail MIME payload', () => {
		const message = normalizeGetMessage({
			body: 'Plain fallback',
			headers: { subject: 'Test' },
			message: {
				id: 'message',
				payload: {
					mimeType: 'multipart/mixed',
					parts: [
						{
							mimeType: 'text/plain',
							headers: [{ name: 'Content-Disposition', value: 'attachment; filename="note.txt"' }],
							body: { data: encoded('Attachment') }
						},
						{
							mimeType: 'multipart/alternative',
							parts: [
								{ mimeType: 'text/plain', body: { data: encoded('Plain body') } },
								{ mimeType: 'text/html', body: { data: encoded('<p>HTML body</p>') } }
							]
						}
					]
				}
			}
		});

		expect(message.bodyText).toBe('Plain body');
		expect(message.bodyHtml).toBe('<p>HTML body</p>');
	});

	it('uses the gog body as text when the MIME payload has no plain part', () => {
		const message = normalizeGetMessage({
			body: 'Readable text',
			headers: {},
			message: {
				id: 'message',
				payload: { mimeType: 'text/html', body: { data: encoded('<p>HTML body</p>') } }
			}
		});

		expect(message.bodyText).toBe('Readable text');
		expect(message.bodyHtml).toBe('<p>HTML body</p>');
	});
});

describe('gog command execution', () => {
	it('retries Google rate-limit failures with backoff before returning JSON', async () => {
		const attempts: string[][] = [];
		const delays: number[] = [];
		let calls = 0;

		await expect(runGogJson(['gog', 'contacts', 'get'], {
			runCommand: async (command) => {
				attempts.push(command);
				calls += 1;
				return calls === 1
					? {
						stdout: '',
						stderr: 'Google API error (429 rateLimitExceeded): quota exceeded',
						exitCode: 7
					}
					: { stdout: '{"ok":true}', stderr: '', exitCode: 0 };
			},
			sleep: async (delay) => {
				delays.push(delay);
			},
			random: () => 0
		})).resolves.toEqual({ ok: true });

		expect(attempts).toHaveLength(2);
		expect(delays).toEqual([1000]);
	});

	it('does not retry non-rate-limit failures', async () => {
		let calls = 0;

		await expect(runGogJson(['gog', 'contacts', 'get'], {
			runCommand: async () => {
				calls += 1;
				return { stdout: '', stderr: 'invalid credentials', exitCode: 7 };
			},
			sleep: async () => {
				throw new Error('unexpected retry');
			}
		})).rejects.toThrow('invalid credentials');

		expect(calls).toBe(1);
	});
});
