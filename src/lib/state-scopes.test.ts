import { expect, it } from 'bun:test';
import { parseStateScopes } from './state-scopes';

it('parses known scopes and treats unknown scopes as a full refresh', () => {
  expect(parseStateScopes('mail,drafts')).toEqual(new Set(['mail', 'drafts']));
  expect(parseStateScopes('all')).toEqual(new Set(['all']));
  expect(parseStateScopes('mail,future')).toEqual(new Set(['mail', 'all']));
});
