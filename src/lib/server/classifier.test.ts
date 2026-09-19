import { describe, expect, it } from 'bun:test';
import { JEV_BODY_MAX_LENGTH, truncateBodyForJev } from './classifier';

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
