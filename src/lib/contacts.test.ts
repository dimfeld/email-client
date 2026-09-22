import { describe, expect, it } from 'bun:test';
import type { SyncedContact } from './server/types';
import { contactInitials, contactKey, contactLabel, contactMatches, groupContacts } from './contacts';

function contact(overrides: Partial<SyncedContact>): SyncedContact {
	return {
		accountEmail: 'owner@example.com', resourceName: `people/${overrides.displayName ?? overrides.organization ?? 'x'}`,
		displayName: '', emails: [], phones: [], organization: null, ...overrides
	};
}

describe('contact labels', () => {
	it('falls back from display name to organization, email, and phone', () => {
		expect(contactLabel(contact({ displayName: 'Ada Lovelace', organization: 'Analytical' }))).toBe('Ada Lovelace');
		expect(contactLabel(contact({ organization: 'Kaiser Lihue', phones: ['+18082465600'] }))).toBe('Kaiser Lihue');
		expect(contactLabel(contact({ emails: ['a@b.com'], phones: ['1'] }))).toBe('a@b.com');
		expect(contactLabel(contact({ phones: ['650-605-8395'] }))).toBe('650-605-8395');
		expect(contactLabel(contact({}))).toBe('Unnamed contact');
	});

	it('builds initials from the first and last words', () => {
		expect(contactInitials(contact({ displayName: 'Ada King Lovelace' }))).toBe('AL');
		expect(contactInitials(contact({ displayName: 'ada' }))).toBe('A');
		expect(contactInitials(contact({ organization: 'Hawaiian Airlines' }))).toBe('HA');
		expect(contactInitials(contact({ phones: ['1'] }))).toBe('?');
	});

	it('keys contacts by account and resource name', () => {
		expect(contactKey({ accountEmail: 'a@b.com', resourceName: 'people/1' })).toBe('a@b.com\npeople/1');
	});
});

describe('contactMatches', () => {
	const person = contact({ displayName: 'Ada Lovelace', organization: 'Analytical Engines', emails: ['ada@example.com'], phones: ['+1 555 0100'] });

	it('matches any field case-insensitively and ignores blank queries', () => {
		expect(contactMatches(person, '')).toBe(true);
		expect(contactMatches(person, '  ')).toBe(true);
		expect(contactMatches(person, 'LOVE')).toBe(true);
		expect(contactMatches(person, 'engines')).toBe(true);
		expect(contactMatches(person, '@example')).toBe(true);
		expect(contactMatches(person, '555')).toBe(true);
		expect(contactMatches(person, 'babbage')).toBe(false);
	});
});

describe('groupContacts', () => {
	it('sorts by label and groups by initial with non-letters last', () => {
		const groups = groupContacts([
			contact({ displayName: 'bob' }),
			contact({ phones: ['650-605-8395'] }),
			contact({ displayName: 'Émile' }),
			contact({ organization: 'Kaiser Lihue', phones: ['1'] }),
			contact({ displayName: 'Alice' }),
			contact({ displayName: 'Ben' })
		]);
		expect(groups.map((group) => group.letter)).toEqual(['A', 'B', 'E', 'K', '#']);
		expect(groups[1].contacts.map(contactLabel)).toEqual(['Ben', 'bob']);
		expect(groups[4].contacts.map(contactLabel)).toEqual(['650-605-8395']);
	});

	it('returns no groups for no contacts', () => {
		expect(groupContacts([])).toEqual([]);
	});
});
