import { importanceLevels, type Importance } from '$lib/categories';
import { senderAddress } from '$lib/remote-images';

export const importanceRuleKinds = ['sender', 'domain', 'subject'] as const;
export type ImportanceRuleKind = (typeof importanceRuleKinds)[number];

export type ImportanceRule = {
  id: number;
  kind: ImportanceRuleKind;
  pattern: string;
  importance: Importance;
};

/** Checks and normalizes a rule from user input. Throws an Error with a message for the user. */
export function normalizeImportanceRule(
  kind: unknown,
  pattern: unknown,
  importance: unknown
): Omit<ImportanceRule, 'id'> {
  if (!importanceRuleKinds.includes(kind as ImportanceRuleKind))
    throw new Error('Select a rule type.');
  if (!importanceLevels.includes(importance as Importance))
    throw new Error('Select an importance.');
  let value = typeof pattern === 'string' ? pattern.trim() : '';
  if (!value) throw new Error('Enter a value for the rule.');
  if (kind === 'sender') {
    const address = senderAddress(value);
    if (!address) throw new Error('Enter a valid email address.');
    value = address;
  } else if (kind === 'domain') {
    value = value.replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) throw new Error('Enter a valid domain.');
  } else {
    try {
      new RegExp(value, 'i');
    } catch {
      throw new Error('Enter a valid regular expression.');
    }
  }
  return { kind: kind as ImportanceRuleKind, pattern: value, importance: importance as Importance };
}

/**
 * Returns the rule that sets the importance of a message, or null.
 * A sender address rule comes first, then a domain rule, then a subject rule.
 * A domain rule also matches subdomains.
 */
export function matchImportanceRule(
  email: { from?: string; subject?: string },
  rules: ImportanceRule[]
): ImportanceRule | null {
  const address = senderAddress(email.from ?? '');
  const domain = address?.split('@')[1];
  const subject = email.subject ?? '';
  const matches = (rule: ImportanceRule) => {
    if (rule.kind === 'sender') return rule.pattern === address;
    if (rule.kind === 'domain')
      return !!domain && (domain === rule.pattern || domain.endsWith(`.${rule.pattern}`));
    return new RegExp(rule.pattern, 'i').test(subject);
  };
  for (const kind of importanceRuleKinds) {
    const rule = rules.find((rule) => rule.kind === kind && matches(rule));
    if (rule) return rule;
  }
  return null;
}
