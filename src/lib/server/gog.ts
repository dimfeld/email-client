import type { IncomingEmail } from './types';

export class GogCommandError extends Error {
	constructor(
		message: string,
		readonly exitCode: number
	) {
		super(message);
	}
}

export async function runGogJson(command: string[]): Promise<unknown> {
	const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited
	]);
	if (exitCode !== 0) {
		throw new GogCommandError(stderr.trim() || `${command[0]} exited with ${exitCode}.`, exitCode);
	}
	return JSON.parse(stdout);
}

function stringValue(value: Record<string, unknown>, ...keys: string[]): string | undefined {
	for (const key of keys) if (typeof value[key] === 'string') return value[key] as string;
}

function looksLikeHtml(value: string | undefined): value is string {
	return Boolean(value && /<(?:!doctype|html|head|body|style|div|p|table|br|a|span|img)\b/i.test(value));
}

export function normalizeSearchMessage(
	value: unknown,
	bodyFormat: 'text' | 'html' = 'text'
): IncomingEmail {
	if (!value || typeof value !== 'object') throw new Error('gog returned an invalid message.');
	const message = value as Record<string, unknown>;
	const id = stringValue(message, 'id', 'messageId', 'message_id');
	if (!id) throw new Error('A gog search message did not include an id.');
	const rawLabels = message.labels ?? message.labelIds ?? message.label_ids;
	const body = stringValue(message, 'body', 'textBody', 'text_body', 'bodyText', 'body_text');
	return {
		id,
		threadId: stringValue(message, 'threadId', 'thread_id'),
		from: stringValue(message, 'from', 'fromAddress', 'from_address'),
		to: stringValue(message, 'to', 'toAddress', 'to_address'),
		subject: stringValue(message, 'subject'),
		date: stringValue(message, 'date', 'internalDate', 'internal_date'),
		snippet: stringValue(message, 'snippet'),
		bodyText: bodyFormat === 'text' ? body : undefined,
		bodyHtml: bodyFormat === 'html' && looksLikeHtml(body) ? body : undefined,
		bodyTruncated: Boolean(message.bodyTruncated ?? message.body_truncated),
		labels: Array.isArray(rawLabels)
			? rawLabels.filter((label): label is string => typeof label === 'string')
			: []
	};
}

type GmailPayloadPart = {
	mimeType?: unknown;
	body?: unknown;
	parts?: unknown;
	headers?: unknown;
};

function isAttachment(part: GmailPayloadPart): boolean {
	if (!Array.isArray(part.headers)) return false;
	return part.headers.some((header) => {
		if (!header || typeof header !== 'object') return false;
		const value = header as Record<string, unknown>;
		return typeof value.name === 'string'
			&& value.name.toLowerCase() === 'content-disposition'
			&& typeof value.value === 'string'
			&& /^attachment(?:;|$)/i.test(value.value.trim());
	});
}

function decodePartBody(part: GmailPayloadPart): string | undefined {
	if (!part.body || typeof part.body !== 'object') return undefined;
	const data = (part.body as Record<string, unknown>).data;
	if (typeof data !== 'string' || data.length === 0) return undefined;
	return Buffer.from(data, 'base64url').toString('utf8');
}

function findMimeBody(part: GmailPayloadPart, mimeType: 'text/plain' | 'text/html'): string | undefined {
	if (isAttachment(part)) return undefined;
	if (part.mimeType === mimeType) return decodePartBody(part);
	if (!Array.isArray(part.parts)) return undefined;
	for (const child of part.parts) {
		if (!child || typeof child !== 'object') continue;
		const body = findMimeBody(child as GmailPayloadPart, mimeType);
		if (body !== undefined) return body;
	}
}

export function normalizeGetMessage(value: unknown): IncomingEmail {
	if (!value || typeof value !== 'object') throw new Error('gog returned an invalid message.');
	const result = value as Record<string, unknown>;
	const rawMessage = result.message;
	if (!rawMessage || typeof rawMessage !== 'object') {
		throw new Error('A gog get result did not include a message.');
	}
	const message = rawMessage as Record<string, unknown>;
	const rawHeaders = result.headers;
	const headers =
		rawHeaders && typeof rawHeaders === 'object'
			? (rawHeaders as Record<string, unknown>)
			: ({} as Record<string, unknown>);
	const id = stringValue(message, 'id');
	if (!id) throw new Error('A gog get message did not include an id.');
	const rawLabels = message.labelIds ?? message.label_ids;
	const payload = message.payload && typeof message.payload === 'object'
		? message.payload as GmailPayloadPart
		: {};
	const fallbackBody = stringValue(result, 'body');
	const bodyHtml = findMimeBody(payload, 'text/html');
	const bodyText = findMimeBody(payload, 'text/plain')
		?? (bodyHtml === undefined || !looksLikeHtml(fallbackBody) ? fallbackBody : undefined);

	return {
		id,
		threadId: stringValue(message, 'threadId', 'thread_id'),
		from: stringValue(headers, 'from'),
		to: stringValue(headers, 'to'),
		subject: stringValue(headers, 'subject'),
		date: stringValue(headers, 'date') ?? stringValue(message, 'internalDate', 'internal_date'),
		snippet: stringValue(message, 'snippet'),
		bodyText,
		bodyHtml,
		bodyTruncated: false,
		labels: Array.isArray(rawLabels)
			? rawLabels.filter((label): label is string => typeof label === 'string')
			: []
	};
}
