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

export function normalizeSearchMessage(value: unknown): IncomingEmail {
	if (!value || typeof value !== 'object') throw new Error('gog returned an invalid message.');
	const message = value as Record<string, unknown>;
	const id = stringValue(message, 'id', 'messageId', 'message_id');
	if (!id) throw new Error('A gog search message did not include an id.');
	const rawLabels = message.labels ?? message.labelIds ?? message.label_ids;
	return {
		id,
		threadId: stringValue(message, 'threadId', 'thread_id'),
		from: stringValue(message, 'from', 'fromAddress', 'from_address'),
		to: stringValue(message, 'to', 'toAddress', 'to_address'),
		subject: stringValue(message, 'subject'),
		date: stringValue(message, 'date', 'internalDate', 'internal_date'),
		snippet: stringValue(message, 'snippet'),
		body: stringValue(message, 'body', 'textBody', 'text_body', 'bodyText', 'body_text'),
		bodyTruncated: Boolean(message.bodyTruncated ?? message.body_truncated),
		labels: Array.isArray(rawLabels)
			? rawLabels.filter((label): label is string => typeof label === 'string')
			: []
	};
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

	return {
		id,
		threadId: stringValue(message, 'threadId', 'thread_id'),
		from: stringValue(headers, 'from'),
		to: stringValue(headers, 'to'),
		subject: stringValue(headers, 'subject'),
		date: stringValue(headers, 'date') ?? stringValue(message, 'internalDate', 'internal_date'),
		snippet: stringValue(message, 'snippet'),
		body: stringValue(result, 'body'),
		bodyTruncated: false,
		labels: Array.isArray(rawLabels)
			? rawLabels.filter((label): label is string => typeof label === 'string')
			: []
	};
}
