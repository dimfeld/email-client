export type SearchSuggestionSource = {
  contacts: { name: string; email: string }[];
  domains: string[];
};

export type SearchSuggestion = {
  kind: 'contact' | 'domain';
  label: string;
  detail: string;
  /** The whole query after the suggestion replaces the last word. */
  query: string;
};

/**
 * Suggests contacts and domains for the last word of a search query. A bare word or a `from:`
 * word completes to `from:`, and a `to:` word completes to `to:`. Matches at the start of a
 * word come first.
 */
export function searchSuggestions(
  query: string,
  source: SearchSuggestionSource
): SearchSuggestion[] {
  const match = /(^|\s)(?:(from|to):)?@?([^\s:"]+)$/i.exec(query);
  if (!match) return [];
  const field = (match[2] ?? 'from').toLowerCase();
  const term = match[3].toLowerCase();
  const before = query.slice(0, match.index + match[1].length);
  const complete = (value: string) => `${before}${field}:${value} `;
  const startsWord = (text: string) =>
    text
      .toLowerCase()
      .split(/[\s.@<>"'()-]+/)
      .some((word) => word.startsWith(term));
  const seen = new Set<string>();
  const ranked: { rank: number; suggestion: SearchSuggestion }[] = [];
  for (const { name, email } of source.contacts) {
    const key = email.toLowerCase();
    if (seen.has(key) || !(name.toLowerCase().includes(term) || key.includes(term))) continue;
    seen.add(key);
    ranked.push({
      rank: startsWord(name) || startsWord(email) ? 0 : 1,
      suggestion: {
        kind: 'contact',
        label: name || email,
        detail: name ? email : '',
        query: complete(email),
      },
    });
  }
  for (const domain of source.domains) {
    if (!domain.includes(term)) continue;
    ranked.push({
      rank: startsWord(domain) ? 0 : 1,
      suggestion: { kind: 'domain', label: domain, detail: 'Domain', query: complete(domain) },
    });
  }
  return ranked.sort((a, b) => a.rank - b.rank).map(({ suggestion }) => suggestion);
}
