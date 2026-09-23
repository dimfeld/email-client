import { afterEach, describe, expect, it } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import type { EmailClassifier } from './classifier';
import { createDatabase, listAccounts, listEmails, upsertAccount } from './db';
import type { EmailExtractor } from './extractor';
import { ingestGmailPayload } from './ingest';

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

const classify: EmailClassifier = async (email) => ({
  category: email.subject?.includes('Reply') ? 'action' : 'newsletter',
  importance: email.subject?.includes('Reply') ? 'important' : 'useful',
  hasActionItem: Boolean(email.subject?.includes('Reply')),
  actionItemProbability: email.subject?.includes('Reply') ? 0.8 : 0.1,
  hasReminder: true,
  reminderProbability: 0.7,
  model: 'jev-test',
  categoryConfidence: 0.8,
  importanceConfidence: 0.9,
  categoryProbabilities: { action: 0.8, newsletter: 0.2 },
  importanceProbabilities: { important: 0.9, other: 0.1 },
});

describe('Gmail ingestion', () => {
  it('stores accounts separately and does not classify an unchanged duplicate twice', async () => {
    database = createDatabase(':memory:');
    let calls = 0;
    const countingClassifier: EmailClassifier = async (email) => {
      calls += 1;
      return classify(email);
    };
    const message = {
      id: 'same-gmail-id',
      subject: 'Reply requested',
      from: 'Alex <alex@example.com>',
      date: '2026-09-18T12:00:00Z',
    };

    await ingestGmailPayload(
      database,
      { source: 'gmail', account: 'one@example.com', deletedMessageIds: [], messages: [message] },
      countingClassifier
    );
    await ingestGmailPayload(
      database,
      { source: 'gmail', account: 'one@example.com', deletedMessageIds: [], messages: [message] },
      countingClassifier
    );
    await ingestGmailPayload(
      database,
      { source: 'gmail', account: 'two@example.com', deletedMessageIds: [], messages: [message] },
      countingClassifier
    );

    expect(calls).toBe(2);
    expect(listEmails(database)).toHaveLength(2);
    expect(listAccounts(database).map((account) => account.email)).toEqual([
      'one@example.com',
      'two@example.com',
    ]);
  });

  it('stores the Jev category, importance, action item, and reminder decisions', async () => {
    database = createDatabase(':memory:');
    await ingestGmailPayload(
      database,
      {
        source: 'gmail',
        account: 'one@example.com',
        deletedMessageIds: [],
        messages: [{ id: 'message-1', subject: 'Reply requested' }],
      },
      classify
    );

    const [email] = listEmails(database);
    expect(email.category).toBe('action');
    expect(email.importance).toBe('important');
    expect(email.hasActionItem).toBe(true);
    expect(email.actionItemProbability).toBe(0.8);
    expect(email.hasReminder).toBe(true);
    expect(email.reminderProbability).toBe(0.7);
    expect(email.categoryConfidence).toBe(0.8);
    expect(email.importanceConfidence).toBe(0.9);
  });

  it('passes the account to classification and extraction', async () => {
    database = createDatabase(':memory:');
    const seen: string[] = [];
    await ingestGmailPayload(
      database,
      {
        source: 'gmail',
        account: 'owner@example.com',
        deletedMessageIds: [],
        messages: [{ id: 'message', subject: 'Reply requested' }],
      },
      async (email, account) => {
        seen.push(`classify:${account}`);
        return classify(email);
      },
      async (_email, _targets, account) => {
        seen.push(`extract:${account}`);
        return { actionItems: [], reminders: [], model: 'test' };
      }
    );
    expect(seen).toEqual(['classify:owner@example.com', 'extract:owner@example.com']);
  });

  it('extracts and stores the action items and reminders selected by Jev', async () => {
    database = createDatabase(':memory:');
    let targets: Parameters<EmailExtractor>[1] | undefined;
    const extract: EmailExtractor = async (_email, requested) => {
      targets = requested;
      return {
        actionItems: [{ title: 'Reply', details: 'Confirm attendance.', dueAt: '2026-09-21' }],
        reminders: [{ title: 'Meeting', details: null, remindAt: '2026-09-22T09:00:00-10:00' }],
        model: 'gpt-6-luna',
      };
    };

    const result = await ingestGmailPayload(
      database,
      {
        source: 'gmail',
        account: 'one@example.com',
        deletedMessageIds: [],
        messages: [{ id: 'message-1', subject: 'Reply requested' }],
      },
      classify,
      extract
    );

    expect(result.extracted).toBe(1);
    expect(targets).toEqual({ actionItems: true, reminders: true });
    expect(listEmails(database)[0]).toMatchObject({
      actionItems: [{ title: 'Reply', details: 'Confirm attendance.', dueAt: '2026-09-21' }],
      reminders: [{ title: 'Meeting', details: null, remindAt: '2026-09-22T09:00:00-10:00' }],
      extractionModel: 'gpt-6-luna',
      extractionError: null,
    });
  });

  it('extracts an unchanged pending message after the OpenAI key becomes available', async () => {
    database = createDatabase(':memory:');
    let classifications = 0;
    const countingClassifier: EmailClassifier = async (email) => {
      classifications += 1;
      return classify(email);
    };
    const payload = {
      source: 'gmail' as const,
      account: 'one@example.com',
      deletedMessageIds: [],
      messages: [{ id: 'message-1', subject: 'Reply requested' }],
    };
    await ingestGmailPayload(database, payload, countingClassifier, null);

    const result = await ingestGmailPayload(database, payload, countingClassifier, async () => ({
      actionItems: [{ title: 'Reply', details: null, dueAt: null }],
      reminders: [],
      model: 'gpt-6-luna',
    }));

    expect(classifications).toBe(1);
    expect(result).toMatchObject({ classified: 0, extracted: 1 });
    expect(listEmails(database)[0].actionItems).toHaveLength(1);
  });

  it('does not call OpenAI when Jev selects neither extraction target', async () => {
    database = createDatabase(':memory:');
    let extractions = 0;
    await ingestGmailPayload(
      database,
      {
        source: 'gmail',
        account: 'one@example.com',
        deletedMessageIds: [],
        messages: [{ id: 'message-1', subject: 'Information only' }],
      },
      async (email) => ({
        ...(await classify(email)),
        hasActionItem: false,
        hasReminder: false,
      }),
      async () => {
        extractions += 1;
        return { actionItems: [], reminders: [], model: 'gpt-6-luna' };
      }
    );

    expect(extractions).toBe(0);
  });

  it('keeps the Jev classification when OpenAI extraction fails', async () => {
    database = createDatabase(':memory:');
    await expect(
      ingestGmailPayload(
        database,
        {
          source: 'gmail',
          account: 'one@example.com',
          deletedMessageIds: [],
          messages: [{ id: 'message-1', subject: 'Reply requested' }],
        },
        classify,
        async () => {
          throw new Error('OpenAI unavailable');
        }
      )
    ).resolves.toMatchObject({ classified: 1, extracted: 0 });

    expect(listEmails(database)[0]).toMatchObject({
      category: 'action',
      hasActionItem: true,
      extractionError: 'OpenAI unavailable',
    });
  });

  it('keeps a downloaded message when classification fails', async () => {
    database = createDatabase(':memory:');
    await expect(
      ingestGmailPayload(
        database,
        {
          source: 'gmail',
          account: 'one@example.com',
          deletedMessageIds: [],
          messages: [{ id: 'message-1', subject: 'Unknown' }],
        },
        async () => {
          throw new Error('Jev unavailable');
        }
      )
    ).rejects.toThrow('classification failed');

    const [email] = listEmails(database);
    expect(email.subject).toBe('Unknown');
    expect(email.classificationError).toBe('Jev unavailable');
  });

  it('marks deleted Gmail messages as hidden', async () => {
    database = createDatabase(':memory:');
    await ingestGmailPayload(
      database,
      {
        source: 'gmail',
        account: 'one@example.com',
        deletedMessageIds: [],
        messages: [{ id: 'message-1', subject: 'Reply requested' }],
      },
      classify
    );
    await ingestGmailPayload(
      database,
      {
        source: 'gmail',
        account: 'one@example.com',
        deletedMessageIds: ['message-1'],
        messages: [],
      },
      classify
    );

    expect(listEmails(database)).toHaveLength(0);
  });
});

describe('Gmail account ingestion', () => {
  it('preserves an existing subscription when ingestion refreshes the account', async () => {
    database = createDatabase(':memory:');
    upsertAccount(database, {
      email: 'one@example.com',
      refreshToken: 'token',
      subscription: 'projects/p/subscriptions/mail',
    });
    await ingestGmailPayload(
      database,
      { source: 'gmail', account: 'one@example.com', deletedMessageIds: [], messages: [] },
      classify
    );
    expect(listAccounts(database)[0].subscription).toBe('projects/p/subscriptions/mail');
    expect(listAccounts(database)[0].refreshToken).toBe('token');
  });
});
