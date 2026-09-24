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
  const text: string[] = [];
  const answer = { answer: 'Done.', sources: [], actions: [], references: [] };
  const stream = chunks(
    [
      { type: 'progress', progress: { id: 'search-1', text: 'Searching…', done: false } },
      { type: 'progress', progress: { id: 'search-1', text: 'Found 1 message.', done: true } },
      { type: 'answer-text', text: 'Do' },
      { type: 'answer-text', text: 'Done.' },
      { type: 'answer', answer },
    ],
    12
  );
  expect(
    await readChatStream(
      stream,
      (progress) => seen.push(progress.text),
      (part) => text.push(part)
    )
  ).toEqual(answer);
  expect(seen).toEqual(['Searching…', 'Found 1 message.']);
  expect(text).toEqual(['Do', 'Done.']);
});

test('reports stream errors and missing answers', async () => {
  const partial: string[] = [];
  await expect(
    readChatStream(
      chunks(
        [
          { type: 'answer-text', text: 'Partial' },
          { type: 'error', error: 'Search failed.' },
        ],
        4
      ),
      () => {},
      (text) => partial.push(text)
    )
  ).rejects.toThrow('Search failed.');
  expect(partial).toEqual(['Partial']);
  await expect(readChatStream(chunks([], 0), () => {})).rejects.toThrow('ended early');
});
