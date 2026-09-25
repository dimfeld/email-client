import { expect, test } from 'bun:test';
import { searchSuggestionLimit, searchSuggestions } from './search-suggestions';

const source = {
  contacts: [
    { name: 'Alice Smith', email: 'alice@example.com' },
    { name: 'Alice Smith', email: 'alice@example.com' },
    { name: 'Malik Jones', email: 'mj@work.org' },
    { name: '', email: 'ali@shop.com' },
  ],
  domains: ['example.com', 'khalid.net', 'alibaba.com'],
};

test('completes a bare word to contacts and domains, with word-start matches first', () => {
  expect(searchSuggestions('report ali', source)).toEqual([
    {
      kind: 'contact',
      label: 'Alice Smith',
      detail: 'alice@example.com',
      query: 'report from:alice@example.com ',
    },
    {
      kind: 'contact',
      label: 'ali@shop.com',
      detail: '',
      query: 'report from:ali@shop.com ',
    },
    { kind: 'domain', label: 'alibaba.com', detail: 'Domain', query: 'report from:alibaba.com ' },
    {
      kind: 'contact',
      label: 'Malik Jones',
      detail: 'mj@work.org',
      query: 'report from:mj@work.org ',
    },
    { kind: 'domain', label: 'khalid.net', detail: 'Domain', query: 'report from:khalid.net ' },
  ]);
});

test('keeps the from: or to: field and ignores other filters and finished words', () => {
  expect(searchSuggestions('TO:@exam', source).map((s) => s.query)).toEqual([
    'to:alice@example.com ',
    'to:example.com ',
  ]);
  expect(searchSuggestions('in:inb', source)).toEqual([]);
  expect(searchSuggestions('"ali', source)).toEqual([]);
  expect(searchSuggestions('ali ', source)).toEqual([]);
  expect(searchSuggestions('', source)).toEqual([]);
});

test('returns at most the limit of suggestions', () => {
  const many = { contacts: [], domains: Array.from({ length: 20 }, (_, i) => `site${i}.com`) };
  expect(searchSuggestions('site', many)).toHaveLength(searchSuggestionLimit);
});
