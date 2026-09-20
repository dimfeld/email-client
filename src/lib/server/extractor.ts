import { createOpenAI, type OpenAIResponsesProviderOptions } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { EmailExtraction, IncomingEmail } from './types';

export type ExtractionTargets = {
	actionItems: boolean;
	reminders: boolean;
};

export type EmailExtractor = (
	email: IncomingEmail,
	targets: ExtractionTargets
) => Promise<EmailExtraction>;

const extractionSchema = z.object({
	actionItems: z.array(z.object({
		title: z.string().describe('A short description of the task.'),
		details: z.string().nullable().describe('Necessary task details from the email, or null.'),
		dueAt: z.string().nullable().describe('An explicit due date or time in ISO 8601 format, or null.')
	})),
	reminders: z.array(z.object({
		title: z.string().describe('A short description of what the owner should remember.'),
		details: z.string().nullable().describe('Necessary reminder details from the email, or null.'),
		remindAt: z.string().nullable().describe('An explicit reminder date or time in ISO 8601 format, or null.')
	}))
});

export function createOpenAIEmailExtractor(
	apiKey = process.env.OPENAI_API_KEY,
	generate: typeof generateObject = generateObject
): EmailExtractor | null {
	if (!apiKey) return null;
	const openai = createOpenAI({ apiKey });

	return async (email, targets) => {
		const result = await generate({
			model: openai.responses('gpt-5.6-luna'),
			schema: extractionSchema,
			schemaName: 'email_action_items_and_reminders',
			providerOptions: {
				openai: { reasoningEffort: 'medium' } satisfies OpenAIResponsesProviderOptions
			},
			instructions: `Extract only information that is present in the email. Do not invent tasks, dates, or details.
Return action items only when action item extraction is requested. Return reminders only when reminder extraction is requested.
Use null for a date or time that the email does not state clearly.`,
			prompt: JSON.stringify({
				extract: targets,
				email: {
					from: email.from ?? '',
					to: email.to ?? '',
					subject: email.subject ?? '',
					date: email.date ?? '',
					snippet: email.snippet ?? '',
					body: email.bodyText ?? ''
				}
			})
		});

		return {
			actionItems: targets.actionItems ? result.object.actionItems : [],
			reminders: targets.reminders ? result.object.reminders : [],
			model: result.response.modelId
		};
	};
}
