export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type ChatSource = { id: number; subject: string; from: string; account: string; date: string | null; href: string };
export type ChatAnswer = { answer: string; sources: ChatSource[] };
