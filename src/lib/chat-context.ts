import { getContext } from 'svelte';

export type ChatContext = {
  open: boolean;
  account: string | null;
  currentMessageId: number | null;
  currentItem: { kind: 'note' | 'todo'; id: number } | null;
};

export const chatContextKey = Symbol('chat');

export function getChatContext() {
  return getContext<ChatContext>(chatContextKey);
}
