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
		expect(request?.providerOptions).toEqual({ openai: { reasoningEffort: 'medium' } });
		expect(request?.schemaName).toBe('email_action_items_and_reminders');
		expect(String(request?.instructions)).toContain('Each returned item must be self-contained in its title and details');
		expect(String(request?.instructions)).toContain('Reply to the email with feedback');
		expect(String(request?.instructions)).toContain('If the email does not provide enough context to write a self-contained item, omit that item');
		expect(JSON.parse(String(request?.prompt))).toMatchObject({
			extract: { actionItems: false, reminders: true },
			email: { subject: 'Plan' }
		});
	});
});
