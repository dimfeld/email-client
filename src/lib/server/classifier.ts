import { choice, noul, TypeSafeClient } from '@typesafe-ai/sdk';
import type { Category, Classification, IncomingEmail } from './types';
import { getDatabase, listCategories } from './db';

export type EmailClassifier = (email: IncomingEmail) => Promise<Classification>;

export const JEV_BODY_MAX_LENGTH = 16_000;

export function truncateBodyForJev(body: string | undefined): string {
	return (body ?? '').slice(0, JEV_BODY_MAX_LENGTH);
}

const importanceCriteria = {
	important: 'The owner needs to act on or give priority attention to this message.',
	useful: 'The owner is likely to value, refer to, or intentionally read this message, but it does not need priority attention.',
	other: 'The message does not need priority attention and is not useful to the owner.'
} as const;

const actionItemQuestion = noul(
	'Does this email contain an action item or something that the owner might add to a todo list?',
	{
		true: 'The email asks, requires, or suggests that the owner complete a task, make a decision, reply, review, schedule, or follow up.',
		false: 'The email does not give the owner a task or a possible todo item.'
	}
);

const reminderQuestion = noul(
	'Does this email contain something that might be useful for the owner to add as a reminder?',
	{
		true: 'The owner might benefit from a future reminder about an event, deadline, appointment, renewal, expiration, follow-up, or other time-sensitive information.',
		false: 'The email does not contain information that would be useful in a future reminder.'
	}
);

export function createJevClassifier(
	apiKey = process.env.TYPESAFE_API_KEY ?? process.env.JEV_API_KEY,
	getCategories: () => Category[] = () => listCategories(getDatabase())
): EmailClassifier {
	if (!apiKey) throw new Error('Set TYPESAFE_API_KEY or JEV_API_KEY before classifying email.');
	const client = new TypeSafeClient({ apiKey, defaultModel: process.env.TYPESAFE_MODEL ?? 'jev-latest' });

	return async (email) => {
		const categories = getCategories();
		if (categories.length === 0) throw new Error('Add a category in Settings before classifying email.');
		const categoryCriteria = Object.fromEntries(categories.map((category) => [
			category.id, `${category.name}: ${category.description}`
		]));
		const state = {
			from: email.from ?? '',
			to: email.to ?? '',
			subject: email.subject ?? '',
			date: email.date ?? '',
			snippet: email.snippet ?? '',
			body: truncateBodyForJev(email.bodyText),
			labels: email.labels ?? []
		};
		const response = await client.systemOne({
			state,
			questions: {
				category: choice('What is the primary category of this email?', categoryCriteria),
				actionItem: actionItemQuestion,
				reminder: reminderQuestion
			}
		});
		const category = categories.find((category) => category.id === response.answers.category.choice);
		if (!category) throw new Error('Jev returned an unknown category.');
		const automatic = category.level === 'auto'
			? await client.systemOne({
				state: { ...state, category: { name: category.name, description: category.description } },
				questions: { importance: choice('How important is this email to its owner?', importanceCriteria) }
			})
			: null;
		const importance = automatic?.answers.importance.choice ?? null;
		return {
			category: category.id,
			importance,
			hasActionItem: response.answers.actionItem.noul >= 0.5,
			actionItemProbability: response.answers.actionItem.noul,
			hasReminder: response.answers.reminder.noul >= 0.5,
			reminderProbability: response.answers.reminder.noul,
			model: response.model,
			categoryConfidence: response.answers.category.confidence,
			importanceConfidence: automatic?.answers.importance.confidence ?? null,
			categoryProbabilities: { ...response.answers.category.probabilities },
			importanceProbabilities: automatic ? { ...automatic.answers.importance.probabilities } : {}
		};
	};
}
