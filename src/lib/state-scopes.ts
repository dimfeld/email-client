// Kinds of server state that change independently. The client refreshes only the data for
// the scopes in a change event. `all` means the client may have missed events.
export const stateScopes = [
  'mail',
  'accounts',
  'categories',
  'contacts',
  'calendar',
  'drafts',
  'backfill',
] as const;
export type StateScope = (typeof stateScopes)[number] | 'all';

export function parseStateScopes(data: string): Set<StateScope> {
  const scopes = new Set<StateScope>();
  for (const value of data.split(',')) {
    const scope = value.trim();
    // An unknown scope comes from a newer server, so refresh everything.
    scopes.add(
      scope === 'all' || (stateScopes as readonly string[]).includes(scope)
        ? (scope as StateScope)
        : 'all'
    );
  }
  return scopes;
}
