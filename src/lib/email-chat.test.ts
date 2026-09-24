import { expect, test } from 'bun:test';
import { linkMessageReferences } from './email-chat';

test('links known message references and keeps other text unchanged', () => {
  expect(
    linkMessageReferences('1. First [12]\n2. Unknown [99] and [12].', [
      { id: 12, href: '/?account=one%40test.com&message=12' },
    ])
  ).toEqual([
    { text: '1. First ' },
    { text: '[12]', href: '/?account=one%40test.com&message=12' },
    { text: '\n2. Unknown ' },
    { text: '[99]' },
    { text: ' and ' },
    { text: '[12]', href: '/?account=one%40test.com&message=12' },
    { text: '.' },
  ]);
});
