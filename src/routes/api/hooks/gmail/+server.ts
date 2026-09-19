import { json } from '@sveltejs/kit';
import { createJevClassifier } from '$lib/server/classifier';
import { getDatabase } from '$lib/server/db';
import { GmailPayloadError, ingestGmailPayload, parseGmailPayload } from '$lib/server/ingest';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const expectedToken = process.env.GMAIL_HOOK_TOKEN;
	if (expectedToken && request.headers.get('authorization') !== `Bearer ${expectedToken}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let payload;
	try {
		payload = parseGmailPayload(await request.json());
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Invalid Gmail payload.' },
			{ status: error instanceof GmailPayloadError || error instanceof SyntaxError ? 400 : 503 }
		);
	}

	try {
		const result = await ingestGmailPayload(getDatabase(), payload, createJevClassifier());
		return json(result);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Gmail ingestion failed.' },
			{ status: 503 }
		);
	}
};
