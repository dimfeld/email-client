import { describe, expect, it } from 'bun:test';
import { normalizeGetMessage, normalizeSearchMessage } from './gog';

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
