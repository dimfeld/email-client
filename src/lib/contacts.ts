import type { SyncedContact } from '$lib/server/types';

export type ContactGroup = { letter: string; contacts: SyncedContact[] };

/** The letter that groups names with no alphabetic initial, as address books conventionally do. */
export const otherGroupLetter = '#';

export function contactKey(contact: Pick<SyncedContact, 'accountEmail' | 'resourceName'>): string {
  return `${contact.accountEmail}\n${contact.resourceName}`;
}

/** The name shown for a contact: the display name, or the organization for company-only entries, or a contact method. */
export function contactLabel(contact: SyncedContact): string {
  return (
    contact.displayName ||
    contact.organization ||
    contact.emails[0] ||
    contact.phones[0] ||
    'Unnamed contact'
  );
}

/** Whether the label is a fallback rather than the person's name. */
export function contactIsUnnamed(contact: SyncedContact): boolean {
  return !contact.displayName;
}

export function contactInitials(contact: SyncedContact): string {
  const words = (contact.displayName || contact.organization || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  const initials =
    words.length === 1
      ? words[0].slice(0, 1)
      : words[0].slice(0, 1) + words[words.length - 1].slice(0, 1);
  return initials.toUpperCase();
}

function groupLetter(label: string): string {
  const first = label
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .slice(0, 1)
    .toUpperCase();
  return /^[A-Z]$/.test(first) ? first : otherGroupLetter;
}

export function contactMatches(contact: SyncedContact, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [contact.displayName, contact.organization, ...contact.emails, ...contact.phones].some(
    (value) => value?.toLowerCase().includes(needle)
  );
}

/**
 * Sorts contacts by their label and groups them by initial letter. Labels with no alphabetic initial
 * go into the `#` group at the end.
 */
export function groupContacts(contacts: SyncedContact[]): ContactGroup[] {
  const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
  const sorted = [...contacts].sort((a, b) => collator.compare(contactLabel(a), contactLabel(b)));
  const groups = new Map<string, SyncedContact[]>();
  for (const contact of sorted) {
    const letter = groupLetter(contactLabel(contact));
    groups.set(letter, [...(groups.get(letter) ?? []), contact]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) =>
      a === otherGroupLetter ? 1 : b === otherGroupLetter ? -1 : a.localeCompare(b)
    )
    .map(([letter, members]) => ({ letter, contacts: members }));
}
