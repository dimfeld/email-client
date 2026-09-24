export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type ChatSource = {
  id: number;
  subject: string;
  from: string;
  account: string;
  date: string | null;
  href: string;
};
export type ChatAction = { kind: 'message' | 'draft'; id: number | string; label: string };
export type ChatReference = { id: number; href: string };
export type ChatAnswer = {
  answer: string;
  sources: ChatSource[];
  actions: ChatAction[];
  references: ChatReference[];
};
export function linkMessageReferences(text: string, references: ChatReference[]) {
  const links = new Map(references.map(({ id, href }) => [id, href]));
  const parts: { text: string; href?: string }[] = [];
  let offset = 0;
  for (const match of text.matchAll(/\[(\d+)\]/g)) {
    const index = match.index ?? 0;
    if (index > offset) parts.push({ text: text.slice(offset, index) });
    const href = links.get(Number(match[1]));
    parts.push(href ? { text: match[0], href } : { text: match[0] });
    offset = index + match[0].length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset) });
  return parts;
}
export type ChatProgress = { id: string; text: string; done: boolean };
export type ChatStreamEvent =
  | { type: 'progress'; progress: ChatProgress }
  | { type: 'answer'; answer: ChatAnswer }
  | { type: 'error'; error: string };
