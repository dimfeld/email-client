import { describe, expect, it, spyOn } from 'bun:test';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import type { Category } from './types';
import { createJevClassifier, JEV_BODY_MAX_LENGTH, truncateBodyForJev } from './classifier';

describe('Jev classifier input', () => {
	it('truncates the message body to 16,000 characters', () => {
		const body = 'a'.repeat(JEV_BODY_MAX_LENGTH + 1);

		expect(truncateBodyForJev(body)).toHaveLength(JEV_BODY_MAX_LENGTH);
		expect(truncateBodyForJev(body)).toBe(body.slice(0, JEV_BODY_MAX_LENGTH));
	});

	it('turns an absent message body into an empty string', () => {
		expect(truncateBodyForJev(undefined)).toBe('');
	});
});


describe('configurable Jev categories', () => {
	it('sends category names and descriptions and reads changes on each call', async () => {
		const request = spyOn(TypeSafeClient.prototype, 'systemOne').mockResolvedValue({
			model: 'test',
			answers: {
				category: { choice: 'custom', confidence: 1, probabilities: { custom: 1 } },
				actionItem: { noul: 0.8 },
				reminder: { noul: 0.3 }
			}
		} as never);
		try {
			let categories: Category[] = [{ id: 'custom', name: 'Travel', description: 'Flights and hotels.', level: 'important' }];
			const classify = createJevClassifier('test-key', () => categories);
			const result = await classify({ id: 'message' });
			expect(result.category).toBe('custom');
			expect(result.importance).toBeNull();
			expect(result).toMatchObject({
				hasActionItem: true,
				actionItemProbability: 0.8,
				hasReminder: false,
				reminderProbability: 0.3
			});
			expect(Object.keys(request.mock.calls[0][0].questions)).toEqual(['category', 'actionItem', 'reminder']);
			expect(request.mock.calls[0][0].questions.category).toEqual(expect.objectContaining({ criteria: { custom: 'Travel: Flights and hotels.' } }));
			expect(request.mock.calls[0][0].questions.actionItem).toEqual(expect.objectContaining({
				type: 'noul',
				instructions: expect.stringContaining('todo list')
			}));
			expect(request.mock.calls[0][0].questions.reminder).toEqual(expect.objectContaining({
				type: 'noul',
				instructions: expect.stringContaining('reminder')
			}));
			categories = [{ id: 'custom', name: 'Trips', description: 'Upcoming trips only.', level: 'other' }];
			await classify({ id: 'message-2' });
			expect(request.mock.calls[1][0].questions.category).toEqual(expect.objectContaining({ criteria: { custom: 'Trips: Upcoming trips only.' } }));
			categories = [];
			await expect(classify({ id: 'message-3' })).rejects.toThrow('Add a category');
			expect(request).toHaveBeenCalledTimes(2);
		} finally {
			request.mockRestore();
		}
	});
});

for (const importance of ['important', 'useful', 'other'] as const) {
	it(`asks Jev for three-state importance only for Auto and stores ${importance}`, async () => {
		const request = spyOn(TypeSafeClient.prototype, 'systemOne')
			.mockResolvedValueOnce({ model: 'test', answers: {
				category: { choice: 'custom', confidence: 0.8, probabilities: { custom: 0.8 } },
				actionItem: { noul: 0.5 }, reminder: { noul: 0.5 }
			} } as never)
			.mockResolvedValueOnce({ model: 'test', answers: { importance: { choice: importance, confidence: 0.7, probabilities: { [importance]: 0.7 } } } } as never);
		try {
			const classify = createJevClassifier('test-key', () => [{ id: 'custom', name: 'Travel', description: 'Travel messages.', level: 'auto' }]);
			const result = await classify({ id: 'message' });
			expect(result.importance).toBe(importance);
			expect(result.importanceConfidence).toBe(0.7);
			expect(result.importanceProbabilities).toEqual({ [importance]: 0.7 });
			expect(request).toHaveBeenCalledTimes(2);
			expect(Object.keys(request.mock.calls[1][0].questions.importance.criteria ?? {})).toEqual(['important', 'useful', 'other']);
		} finally {
			request.mockRestore();
		}
	});
}
