import { describe, expect, it, mock } from 'bun:test';
import type { generateObject } from 'ai';
import { createOpenAIEmailExtractor } from './extractor';

describe('OpenAI email extraction', () => {
	it('is disabled when the OpenAI API key is absent', () => {
		expect(createOpenAIEmailExtractor('')).toBeNull();
	});

	it('uses GPT-5.6 Luna with medium reasoning and returns only requested results', async () => {
		let request: Record<string, unknown> | undefined;
		const generateMock = mock(async (options: Record<string, unknown>) => {
			request = options;
			return {
				object: {
					actionItems: [{ title: 'Reply to Alex', details: 'Confirm the plan.', dueAt: null }],
					reminders: [{ title: 'Plan starts', details: null, remindAt: '2026-09-25' }]
				},
				response: { modelId: 'gpt-5.6-luna' }
			} as never;
		});
		const generate = generateMock as unknown as typeof generateObject;
		const extract = createOpenAIEmailExtractor('test-key', generate);

		const result = await extract!({
			id: 'message',
			from: 'alex@example.com',
			subject: 'Plan',
			bodyText: 'Please reply. The plan starts September 25.'
		}, { actionItems: false, reminders: true });

		expect(result).toEqual({
			actionItems: [],
			reminders: [{ title: 'Plan starts', details: null, remindAt: '2026-09-25' }],
			model: 'gpt-5.6-luna'
		});
		expect((request?.model as { modelId: string }).modelId).toBe('gpt-5.6-luna');
		expect(request?.maxRetries).toBe(0);
		expect(request?.providerOptions).toEqual({ openai: { reasoningEffort: 'medium', serviceTier: 'flex' } });
		expect(request?.schemaName).toBe('email_action_items_and_reminders');
		expect(String(request?.instructions)).toContain('Each returned item must be self-contained in its title and details');
		expect(String(request?.instructions)).toContain('Reply to the email with feedback');
		expect(String(request?.instructions)).toContain('If the email does not provide enough context to write a self-contained item, omit that item');
		expect(JSON.parse(String(request?.prompt))).toMatchObject({
			extract: { actionItems: false, reminders: true },
			email: { subject: 'Plan' }
		});
	});

	it('retries once on the regular tier after a Flex resource error', async () => {
		const requests: Record<string, unknown>[] = [];
		let attempt = 0;
		const generateMock = mock(async (options: Record<string, unknown>) => {
			requests.push(options);
			attempt += 1;
			if (attempt === 1) {
				throw { message: '429 Resource Unavailable', statusCode: 429 };
			}
			return {
				object: { actionItems: [], reminders: [] },
				response: { modelId: 'gpt-5.6-luna' }
			} as never;
		});
		const extract = createOpenAIEmailExtractor('test-key', generateMock as unknown as typeof generateObject);

		await extract!({ id: 'message', subject: 'Plan', bodyText: 'The plan starts September 25.' }, {
			actionItems: false,
			reminders: true
		});

		expect(requests).toHaveLength(2);
		expect((requests[0].providerOptions as { openai: { serviceTier: string } }).openai.serviceTier).toBe('flex');
		expect((requests[1].providerOptions as { openai: { serviceTier: string } }).openai.serviceTier).toBe('auto');
		expect(requests[0].maxRetries).toBe(0);
		expect(requests[1].maxRetries).toBe(0);
	});

	it('does not retry other errors', async () => {
		let calls = 0;
		const generateMock = mock(async () => {
			calls += 1;
			throw { message: '429 Too Many Requests', statusCode: 429 };
		});
		const extract = createOpenAIEmailExtractor('test-key', generateMock as unknown as typeof generateObject);

		await expect(extract!({ id: 'message', bodyText: 'Text' }, {
			actionItems: true,
			reminders: false
		})).rejects.toMatchObject({ message: '429 Too Many Requests' });
		expect(calls).toBe(1);
	});
});
