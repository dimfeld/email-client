export type RemoteImageRule = { kind: 'address' | 'domain'; value: string };

export function senderAddress(from: string): string | null {
  const address = (
    from.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] ??
    from.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0]
  )?.toLowerCase();
  return address && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? address : null;
}

export function senderDomain(from: string): string | null {
  return senderAddress(from)?.split('@')[1] ?? null;
}

export function allowsRemoteImages(from: string, rules: RemoteImageRule[]): boolean {
  const address = senderAddress(from);
  if (!address) return false;
  const domain = address.split('@')[1];
  return rules.some((rule) =>
    rule.kind === 'address' ? rule.value === address : rule.value === domain
  );
}
