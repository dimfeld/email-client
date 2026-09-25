import { createOpenAI, type OpenAIResponsesProviderOptions } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { EmailExtraction, IncomingEmail } from './types';
import { getAccountDisplayName, getDatabase } from './db';

export type ExtractionTargets = {
  actionItems: boolean;
  reminders: boolean;
};

export type EmailExtractor = (
  email: IncomingEmail,
  targets: ExtractionTargets,
  accountEmail?: string
) => Promise<EmailExtraction>;

function isFlexResourceUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const apiError = error as {
    message?: unknown;
    responseBody?: unknown;
    statusCode?: unknown;
  };
  if (apiError.statusCode !== 429) return false;

  return [apiError.message, apiError.responseBody]
    .filter((value): value is string => typeof value === 'string')
    .some((value) => /resource unavailable/i.test(value));
}

const extractionSchema = z.object({
  actionItems: z.array(
    z.object({
      title: z
        .string()
        .describe(
          'A concise, self-contained task description. Include the concrete person, subject, project, event, product, or other context needed to identify the task without seeing the email.'
        ),
      details: z
        .string()
        .nullable()
        .describe('Details from the email that make the task self-contained, or null.'),
      dueAt: z
        .string()
        .nullable()
        .describe('An explicit due date or time in ISO 8601 format, or null.'),
    })
  ),
  reminders: z.array(
    z.object({
      title: z
        .string()
        .describe(
          'A concise, self-contained reminder description. Include the concrete person, subject, project, event, product, deadline, or other context needed to identify the reminder without seeing the email.'
        ),
      details: z
        .string()
        .nullable()
        .describe('Details from the email that make the reminder self-contained, or null.'),
      remindAt: z
        .string()
        .nullable()
        .describe('An explicit reminder date or time in ISO 8601 format, or null.'),
    })
  ),
});

export function createOpenAIEmailExtractor(
  apiKey = process.env.OPENAI_API_KEY,
  generate: typeof generateObject = generateObject,
  getOwnerName: (accountEmail: string) => string | null = (accountEmail) =>
    getAccountDisplayName(getDatabase(), accountEmail)
): EmailExtractor | null {
  if (!apiKey) return null;
  const openai = createOpenAI({ apiKey });

  return async (email, targets, accountEmail) => {
    const generateExtraction = (serviceTier: 'flex' | 'auto') =>
      generate({
        model: openai.responses('gpt-6-luna'),
        schema: extractionSchema,
        schemaName: 'email_action_items_and_reminders',
        maxRetries: 2,
        providerOptions: {
          openai: {
            reasoningEffort: 'medium',
            serviceTier,
          } satisfies OpenAIResponsesProviderOptions,
        },
        instructions: `Extract only information that is present in the email. Do not invent tasks, dates, or details.
Each returned item must be self-contained in its title and details. Write it so a person can understand what it is without seeing the email. Include concrete context from the email, such as names, the subject, project, event, product, deadline, or reason. Do not use generic text such as "Reply to the email with feedback", "Follow up", or "Remember this" when it does not identify the subject. If the email does not provide enough context to write a self-contained item, omit that item.
Return an action item only when the email states what the owner must do, decide, reply to, review, schedule, or follow up on. Return a reminder only when the email states what the owner should remember and why. Do not rely on another message, a missing thread, an attachment, a link, or outside context.
Return action items only when action item extraction is requested. Return reminders only when reminder extraction is requested.
Use the owner's name and email address to decide who an ask is for. Omit action items and task reminders clearly addressed to another person, even when the owner received the email. If the addressee is unclear, use the other evidence in the message.
Use null for a date or time that the email does not state clearly.`,
        prompt: JSON.stringify({
          extract: targets,
          owner: {
            name: accountEmail ? getOwnerName(accountEmail) : null,
            email: accountEmail ?? null,
          },
          email: {
            from: email.from ?? '',
            to: email.to ?? '',
            subject: email.subject ?? '',
            date: email.date ?? '',
            snippet: email.snippet ?? '',
            body: email.bodyText ?? '',
          },
        }),
      });
    let result;
    try {
      result = await generateExtraction('flex');
    } catch (error) {
      if (!isFlexResourceUnavailableError(error)) throw error;
      result = await generateExtraction('auto');
    }

    return {
      actionItems: targets.actionItems ? result.object.actionItems : [],
      reminders: targets.reminders ? result.object.reminders : [],
      model: result.response.modelId,
    };
  };
}
