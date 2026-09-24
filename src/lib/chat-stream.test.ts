import { expect, test } from 'bun:test';
import { readChatStream } from './chat-stream';
import type { ChatStreamEvent } from './email-chat';

function chunks(events: ChatStreamEvent[], split: number) {
  const bytes = new TextEncoder().encode(
    events.map((event) => JSON.stringify(event)).join('\n') + '\n'
  );
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, split));
      controller.enqueue(bytes.slice(split));
      controller.close();
    },
  });
}

test('reads progress and the answer across network chunks', async () => {
  const seen: string[] = [];
  const answer = { answer: 'Done.', sources: [], actions: [] };
  const stream = chunks(
    [
      { type: 'progress', progress: { id: 'search-1', text: 'Searching…', done: false } },
      { type: 'progress', progress: { id: 'search-1', text: 'Found 1 message.', done: true } },
      { type: 'answer', answer },
    ],
    12
  );
  expect(await readChatStream(stream, (progress) => seen.push(progress.text))).toEqual(answer);
  expect(seen).toEqual(['Searching…', 'Found 1 message.']);
});

test('reports stream errors and missing answers', async () => {
  await expect(
    readChatStream(chunks([{ type: 'error', error: 'Search failed.' }], 4), () => {})
  ).rejects.toThrow('Search failed.');
  await expect(readChatStream(chunks([], 0), () => {})).rejects.toThrow('ended early');
});
