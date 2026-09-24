import type { ChatAnswer, ChatProgress, ChatStreamEvent } from './email-chat';

export async function readChatStream(
  body: ReadableStream<Uint8Array>,
  onProgress: (progress: ChatProgress) => void
): Promise<ChatAnswer> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer: ChatAnswer | undefined;
  const receive = (line: string) => {
    if (!line) return;
    const event = JSON.parse(line) as ChatStreamEvent;
    if (event.type === 'error') throw new Error(event.error);
    if (event.type === 'answer') answer = event.answer;
    if (event.type === 'progress') onProgress(event.progress);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) receive(line);
    }
    buffer += decoder.decode();
    receive(buffer);
  } finally {
    reader.releaseLock();
  }
  if (!answer) throw new Error('The chat response ended early.');
  return answer;
}
