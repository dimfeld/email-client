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
export type ChatAnswer = { answer: string; sources: ChatSource[]; actions: ChatAction[] };
export type ChatProgress = { id: string; text: string; done: boolean };
export type ChatStreamEvent =
  | { type: 'progress'; progress: ChatProgress }
  | { type: 'answer'; answer: ChatAnswer }
  | { type: 'error'; error: string };
