export function splitQuotedReply(body: string | undefined): {
  latest: string;
  quotedContext: string;
} {
  const text = body ?? '';
  const lines = text.split(/\r?\n/);
  const quoteIndex = lines.findIndex((line, index) => {
    if (/^\s*>/.test(line)) return true;
    if (/^\s*On .+ wrote:\s*$/i.test(line)) return true;
    if (/^\s*On .+/i.test(line)) {
      if (lines.slice(index + 1, index + 3).some((next) => /\bwrote:\s*$/i.test(next))) return true;
    }
    if (/^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i.test(line)) return true;
    if (!/^\s*From:\s*\S/i.test(line)) return false;

    const followingHeaders = lines.slice(index + 1, index + 6);
    return (
      followingHeaders.some((next) => /^\s*(Sent|Date):\s*\S/i.test(next)) &&
      followingHeaders.some((next) => /^\s*(To|Subject):\s*\S/i.test(next))
    );
  });

  if (quoteIndex < 0) return { latest: text.trim(), quotedContext: '' };
  return {
    latest: lines.slice(0, quoteIndex).join('\n').trim(),
    quotedContext: lines.slice(quoteIndex).join('\n').trim(),
  };
}

export function formatBodyForDecisions(body: string | undefined): string {
  const { latest, quotedContext } = splitQuotedReply(body);
  if (!quotedContext) return `Latest email:\n${latest}`;
  return `Latest email:\n${latest}\n\nQuoted reply context (already processed; use only for decision context):\n${quotedContext}`;
}
