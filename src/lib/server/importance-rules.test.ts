import { describe, expect, it } from 'bun:test';
import {
  matchImportanceRule,
  normalizeImportanceRule,
  type ImportanceRule,
} from './importance-rules';

const rules: ImportanceRule[] = [
  { id: 1, kind: 'subject', pattern: 'invoice #\\d+', importance: 'useful' },
  { id: 2, kind: 'domain', pattern: 'example.com', importance: 'other' },
  { id: 3, kind: 'sender', pattern: 'boss@example.com', importance: 'important' },
];

describe('matchImportanceRule', () => {
  it('uses a sender rule before a domain rule and a domain rule before a subject rule', () => {
    expect(
      matchImportanceRule({ from: 'Boss <Boss@Example.com>', subject: 'Invoice #4' }, rules)?.id
    ).toBe(3);
    expect(matchImportanceRule({ from: 'a@example.com', subject: 'Invoice #4' }, rules)?.id).toBe(
      2
    );
    expect(
      matchImportanceRule({ from: 'a@other.org', subject: 'Re: INVOICE #42' }, rules)?.id
    ).toBe(1);
  });

  it('matches subdomains but not other domains that end with the same text', () => {
    expect(matchImportanceRule({ from: 'a@mail.example.com' }, rules)?.id).toBe(2);
    expect(matchImportanceRule({ from: 'a@notexample.com' }, rules)).toBeNull();
  });

  it('returns null when no rule matches', () => {
    expect(matchImportanceRule({ from: 'a@other.org', subject: 'Hello' }, rules)).toBeNull();
    expect(matchImportanceRule({}, rules)).toBeNull();
  });
});

describe('normalizeImportanceRule', () => {
  it('normalizes sender addresses and domains', () => {
    expect(normalizeImportanceRule('sender', ' Pat <Pat@Example.com> ', 'important')).toEqual({
      kind: 'sender',
      pattern: 'pat@example.com',
      importance: 'important',
    });
    expect(normalizeImportanceRule('domain', '@Example.COM', 'other').pattern).toBe('example.com');
  });

  it('rejects values that are not valid', () => {
    expect(() => normalizeImportanceRule('sender', 'not an address', 'other')).toThrow(
      'valid email address'
    );
    expect(() => normalizeImportanceRule('domain', 'example', 'other')).toThrow('valid domain');
    expect(() => normalizeImportanceRule('subject', '(', 'other')).toThrow('regular expression');
    expect(() => normalizeImportanceRule('subject', ' ', 'other')).toThrow('Enter a value');
    expect(() => normalizeImportanceRule('body', 'x', 'other')).toThrow('rule type');
    expect(() => normalizeImportanceRule('subject', 'x', 'urgent')).toThrow('importance');
  });
});
