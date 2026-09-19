import { choice, TypeSafeClient } from '@typesafe-ai/sdk';
import type { Classification, IncomingEmail } from './types';

export type EmailClassifier = (email: IncomingEmail) => Promise<Classification>;

export const JEV_BODY_MAX_LENGTH = 16_000;

export function truncateBodyForJev(body: string | undefined): string {
	return (body ?? '').slice(0, JEV_BODY_MAX_LENGTH);
}

const categoryCriteria = {
	action: 'The owner must reply, decide, review, schedule, approve, or complete a task.',
	personal: 'A personal message from a person or group, not mainly about work.',
	work: 'Useful work information that does not request a direct action.',
	transaction: 'A receipt, invoice, order, payment, booking, shipment, or account transaction.',
	newsletter: 'A recurring publication, digest, or editorial update that the owner chose to receive.',
	notification: 'An automated service, security, social, product, or system notification.',
	marketing: 'A promotion, sales pitch, product announcement, or commercial campaign.',
	other: 'The message does not fit the other categories.'
} as const;

const usefulnessCriteria = {
	useful:
		'The owner is likely to need, value, act on, refer to, or intentionally read this message.',
	not_useful:
		'The message is noise, unsolicited promotion, low-value automation, spam, or not relevant to the owner.'
} as const;

export function createJevClassifier(
	apiKey = process.env.TYPESAFE_API_KEY ?? process.env.JEV_API_KEY
): EmailClassifier {
	if (!apiKey) throw new Error('Set TYPESAFE_API_KEY or JEV_API_KEY before classifying email.');
	const client = new TypeSafeClient({
		apiKey,
		defaultModel: process.env.TYPESAFE_MODEL ?? 'jev-latest'
	});

	return async (email) => {
		const response = await client.systemOne({
			state: {
				from: email.from ?? '',
				to: email.to ?? '',
				subject: email.subject ?? '',
				date: email.date ?? '',
				snippet: email.snippet ?? '',
				body: truncateBodyForJev(email.body),
				labels: email.labels ?? []
			},
			questions: {
				category: choice('What is the primary category of this email?', categoryCriteria),
				usefulness: choice('Is this email useful to its owner?', usefulnessCriteria)
			}
		});

		return {
			category: response.answers.category.choice,
			useful: response.answers.usefulness.choice === 'useful',
			model: response.model,
			categoryConfidence: response.answers.category.confidence,
			usefulnessConfidence: response.answers.usefulness.confidence,
			categoryProbabilities: { ...response.answers.category.probabilities },
			usefulnessProbabilities: { ...response.answers.usefulness.probabilities }
		};
	};
}
