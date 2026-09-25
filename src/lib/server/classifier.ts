import { choice, noul, TypeSafeClient } from '@typesafe-ai/sdk';
import type { Category, Classification, IncomingEmail } from './types';
import { getAccountDisplayName, getDatabase, listCategories } from './db';

export type EmailClassifier = (
  email: IncomingEmail,
  accountEmail?: string
) => Promise<Classification>;

export const JEV_BODY_MAX_LENGTH = 16_000;

export function truncateBodyForJev(body: string | undefined): string {
  return (body ?? '').slice(0, JEV_BODY_MAX_LENGTH);
}

const importanceCriteria = {
  important: 'The owner needs to act on or give priority attention to this message.',
  useful:
    'The owner is likely to value, refer to, or intentionally read this message, but it does not need priority attention.',
  other: 'The message does not need priority attention and is not useful to the owner.',
} as const;

const actionItemQuestion = noul(
  'Is this email likely to make the owner add a specific task to a todo list?',
  {
    true: 'Choose true only when the email gives the owner a concrete, owner-relevant task, decision, or follow-up that they are likely to track as a todo. The requested action and its subject should be clear enough to identify a specific task. A request or question alone is not enough.',
    false:
      'Choose false for routine questions or requests, generic requests to reply or follow up, optional suggestions, marketing calls to action, notifications, information that only needs reading, tasks for someone else, or anything the owner is not likely to add as a specific todo. Use ownerName and ownerEmail in the state to identify the owner. An ask clearly addressed to another person is not an action item for the owner, even if the owner received the email. Do not exclude an ask when its addressee is unclear.',
  }
);

const reminderQuestion = noul('Is this email likely to make the owner add a specific reminder?', {
  true: 'Choose true only when the email contains a concrete, owner-relevant future event, deadline, appointment, renewal, expiration, or follow-up that the owner is likely to track with a reminder. The reminder topic and timing should be clear enough to identify a specific reminder.',
  false:
    'Choose false for incidental dates, historical information, general schedules, marketing offers, newsletters, routine notifications, or vague future information that the owner is not likely to track as a specific reminder. Use ownerName and ownerEmail in the state to identify the owner. A task or deadline clearly addressed only to another person is not a reminder for the owner.',
});

export function createJevClassifier(
  apiKey = process.env.TYPESAFE_API_KEY,
  getCategories: () => Category[] = () => listCategories(getDatabase()),
  getOwnerName: (accountEmail: string) => string | null = (accountEmail) =>
    getAccountDisplayName(getDatabase(), accountEmail)
): EmailClassifier {
  if (!apiKey) throw new Error('Set TYPESAFE_API_KEY before classifying email.');
  const client = new TypeSafeClient({
    apiKey,
    defaultModel: process.env.TYPESAFE_MODEL ?? 'jev-latest',
    retry: { maxRetries: 2 },
  });

  return async (email, accountEmail) => {
    const categories = getCategories();
    if (categories.length === 0)
      throw new Error('Add a category in Settings before classifying email.');
    const categoryCriteria = Object.fromEntries(
      categories.map((category) => [category.id, `${category.name}: ${category.description}`])
    );
    const state = {
      ownerName: accountEmail ? (getOwnerName(accountEmail) ?? '') : '',
      ownerEmail: accountEmail ?? '',
      from: email.from ?? '',
      to: email.to ?? '',
      subject: email.subject ?? '',
      date: email.date ?? '',
      snippet: email.snippet ?? '',
      body: truncateBodyForJev(email.bodyText),
    };
    const response = await client.systemOne({
      state,
      questions: {
        category: choice('What is the primary category of this email?', categoryCriteria),
        actionItem: actionItemQuestion,
        reminder: reminderQuestion,
        importance: choice('How important is this email to its owner?', importanceCriteria),
      },
    });
    const category = categories.find(
      (category) => category.id === response.answers.category.choice
    );
    if (!category) throw new Error('Jev returned an unknown category.');
    const automatic = category.level === 'auto';
    // A fixed category level is stored as the message's importance when it is classified.
    const importance =
      category.level === 'auto' ? response.answers.importance.choice : category.level;
    return {
      category: category.id,
      importance,
      hasActionItem: response.answers.actionItem.noul >= 0.5,
      actionItemProbability: response.answers.actionItem.noul,
      hasReminder: response.answers.reminder.noul >= 0.5,
      reminderProbability: response.answers.reminder.noul,
      model: response.model,
      categoryConfidence: response.answers.category.confidence,
      importanceConfidence: automatic ? response.answers.importance.confidence : null,
      categoryProbabilities: { ...response.answers.category.probabilities },
      importanceProbabilities: automatic ? { ...response.answers.importance.probabilities } : {},
    };
  };
}
