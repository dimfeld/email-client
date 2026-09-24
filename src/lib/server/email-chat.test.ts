import { afterEach, expect, test } from 'bun:test';
import type { streamText } from 'ai';
import { createDatabase, listEmails, markDeleted, upsertEmails } from './db';
import { chatWithEmail, createEmailChatTools } from './email-chat';

const database = createDatabase(':memory:');
afterEach(() => database.exec('DELETE FROM emails'));
const context = { toolCallId: 'test', messages: [], context: {} };
function fakeResult(
  output: { answer: string; sourceIds: number[] },
  parts: string[] = [],
  before?: () => Promise<void>
) {
  return {
    partialOutputStream: (async function* () {
      await before?.();
      for (const answer of parts) yield { answer };
    })(),
    output: Promise.resolve(output),
  };
}
function seed() {
  upsertEmails(database, 'a@test.com', [
    { id: 'one', subject: 'Launch', bodyText: 'Launch is Friday.', labels: ['INBOX'] },
  ]);
  upsertEmails(database, 'b@test.com', [
    { id: 'two', subject: 'Private', bodyText: 'Other account.', labels: ['INBOX'] },
  ]);
  return {
    one: listEmails(database, 'a@test.com')[0].id,
    two: listEmails(database, 'b@test.com')[0].id,
  };
}

test('tools enforce account scope and record only messages read', async () => {
  const { one, two } = seed();
  const { tools, readSources } = createEmailChatTools(database, 'a@test.com');
  expect(Object.keys(tools)).toEqual(['search', 'read', 'changeMessage', 'createReplyDraft']);
  const found = await tools.search.execute!({ query: '', offset: 0, limit: 10 }, context);
  expect(found).toMatchObject({ results: [{ id: one }] });
  expect(readSources.size).toBe(0);
  await expect(tools.read.execute!({ id: two, offset: 0, length: 100 }, context)).rejects.toThrow(
    'selected account'
  );
  await expect(
    tools.changeMessage.execute!({ id: two, action: 'archive' }, context)
  ).rejects.toThrow('selected account');
  await expect(
    tools.createReplyDraft.execute!({ id: two, text: 'Reply', replyAll: false }, context)
  ).rejects.toThrow('selected account');
  expect(await tools.read.execute!({ id: one, offset: 0, length: 6 }, context)).toMatchObject({
    body: 'Launch',
    nextOffset: 6,
  });
  expect(readSources.get(one)?.href).toBe(`/?account=a%40test.com&message=${one}`);
  markDeleted(database, 'a@test.com', ['one']);
  await expect(tools.read.execute!({ id: one, offset: 0, length: 100 }, context)).rejects.toThrow(
    'not available'
  );
});

test('Jev relevance checks only the selected account and does not count as reading a source', async () => {
  const { one, two } = seed();
  const seen: number[] = [];
  const { tools, readSources } = createEmailChatTools(database, 'a@test.com', async (_, email) => {
    seen.push(email.id);
    return true;
  });
  expect(
    await tools.relevance!.execute!({ question: 'When is launch?', ids: [one] }, context)
  ).toEqual([{ id: one, relevant: true }]);
  await expect(
    tools.relevance!.execute!({ question: 'When?', ids: [two] }, context)
  ).rejects.toThrow('selected account');
  expect(seen).toEqual([one]);
  expect(readSources.size).toBe(0);
});

test('passes conversation to the model and returns verified sources', async () => {
  const { one } = seed();
  const messages = [
    { role: 'user' as const, content: 'Find the launch.' },
    { role: 'assistant' as const, content: 'I found it.' },
    { role: 'user' as const, content: 'When is it?' },
  ];
  const stream = ((options: Parameters<typeof streamText>[0]) => {
    expect(options.messages).toEqual(messages);
    expect(options.instructions).toContain('untrusted data');
    return fakeResult(
      { answer: `Friday [${one}].`, sourceIds: [one] },
      ['Fri', `Friday [${one}].`],
      async () => {
        await options.tools!.read.execute!({ id: one, offset: 0, length: 100 }, context);
      }
    );
  }) as unknown as typeof streamText;
  const partials: string[] = [];
  const result = await chatWithEmail(
    database,
    messages,
    'a@test.com',
    undefined,
    {
      apiKey: 'test',
      stream,
    },
    undefined,
    undefined,
    (text) => partials.push(text)
  );
  expect(partials).toEqual(['Fri', `Friday [${one}].`]);
  expect(result.sources.map((source) => source.id)).toEqual([one]);
  expect(result.references).toEqual([{ id: one, href: `/?account=a%40test.com&message=${one}` }]);
  expect(result.actions).toEqual([]);
});

test('adds the message open at chat start to the instructions', async () => {
  const { one } = seed();
  const stream = ((options: Parameters<typeof streamText>[0]) => {
    expect(options.instructions).toContain(`Message ${one} was open when this chat started`);
    return fakeResult({ answer: 'No action needed.', sourceIds: [] });
  }) as unknown as typeof streamText;
  await chatWithEmail(
    database,
    [{ role: 'user', content: 'Help me.' }],
    'a@test.com',
    undefined,
    {
      apiKey: 'test',
      stream,
    },
    one
  );
});

test('reports tool progress and asks for stable message numbers', async () => {
  seed();
  const updates: string[] = [];
  const stream = ((options: Parameters<typeof streamText>[0]) => {
    expect(options.instructions).toContain('number them 1, 2, 3');
    const toolCall = {
      toolCallId: 'search-1',
      toolName: 'search',
      input: { query: 'in:inbox', offset: 0, limit: 10 },
    };
    return fakeResult({ answer: 'Done.', sourceIds: [] }, [], async () => {
      await options.onToolExecutionStart?.({ toolCall } as never);
      await options.onToolExecutionEnd?.({
        toolCall,
        toolOutput: { type: 'tool-result', output: { results: [{ id: 1 }] } },
      } as never);
    });
  }) as unknown as typeof streamText;
  await chatWithEmail(
    database,
    [{ role: 'user', content: 'Triage mail.' }],
    undefined,
    undefined,
    {
      apiKey: 'test',
      stream,
    },
    undefined,
    (progress) => updates.push(progress.text)
  );
  expect(updates).toEqual(['Searching for in:inbox…', 'Found 1 message for in:inbox.']);
});

test('rejects invented citations and stops tools after cancellation', async () => {
  const { one } = seed();
  const partials: string[] = [];
  const stream = (() =>
    fakeResult({ answer: `Invented [${one}].`, sourceIds: [] }, [
      `Invented [${one}].`,
    ])) as unknown as typeof streamText;
  await expect(
    chatWithEmail(
      database,
      [{ role: 'user', content: 'When?' }],
      undefined,
      undefined,
      {
        apiKey: 'test',
        stream,
      },
      undefined,
      undefined,
      (text) => partials.push(text)
    )
  ).rejects.toThrow('unverified source');
  expect(partials).toEqual([`Invented [${one}].`]);
  const abort = new AbortController();
  abort.abort();
  const { tools } = createEmailChatTools(database, undefined, undefined, abort.signal);
  await expect(
    tools.search.execute!({ query: '', offset: 0, limit: 1 }, context)
  ).rejects.toThrow();
  await expect(
    chatWithEmail(database, [{ role: 'user', content: 'When?' }], undefined, undefined, {
      apiKey: '',
    })
  ).rejects.toThrow('OPENAI_API_KEY');
});
