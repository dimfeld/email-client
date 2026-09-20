import { describe, expect, it } from 'bun:test';
import { normalizeGmailMessage } from './google-api';

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
