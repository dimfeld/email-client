import type { IncomingEmail } from '../src/lib/server/types';

export async function runJson(command: string[]): Promise<unknown> {
	const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited
	]);
	if (exitCode !== 0) throw new Error(stderr.trim() || `${command[0]} exited with ${exitCode}.`);
	return JSON.parse(stdout);
}

export function readFlag(name: string): string | undefined {
	const index = Bun.argv.indexOf(name);
	return index >= 0 ? Bun.argv[index + 1] : undefined;
}

export function requireFlag(name: string): string {
	const value = readFlag(name);
	if (!value) throw new Error(`Missing required ${name} value.`);
	return value;
}

export function normalizeSearchMessage(value: unknown): IncomingEmail {
	if (!value || typeof value !== 'object') throw new Error('gog returned an invalid message.');
	const message = value as Record<string, unknown>;
	const stringValue = (...keys: string[]): string | undefined => {
		for (const key of keys) if (typeof message[key] === 'string') return message[key] as string;
	};
	const id = stringValue('id', 'messageId', 'message_id');
	if (!id) throw new Error('A gog search message did not include an id.');
	const rawLabels = message.labels ?? message.labelIds ?? message.label_ids;
	return {
		id,
		threadId: stringValue('threadId', 'thread_id'),
		from: stringValue('from', 'fromAddress', 'from_address'),
		to: stringValue('to', 'toAddress', 'to_address'),
		subject: stringValue('subject'),
		date: stringValue('date', 'internalDate', 'internal_date'),
		snippet: stringValue('snippet'),
		body: stringValue('body', 'textBody', 'text_body', 'bodyText', 'body_text'),
		bodyTruncated: Boolean(message.bodyTruncated ?? message.body_truncated),
		labels: Array.isArray(rawLabels)
			? rawLabels.filter((label): label is string => typeof label === 'string')
			: []
	};
}
