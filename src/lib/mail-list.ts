/** Inbox rows per page. The owner chose 100. */
export const MAIL_PAGE_SIZE = 100;

/** The display name from a From header, or the address when it has no name. */
export function senderName(from: string): string {
  return from.replace(/\s*<[^>]+>\s*$/, '').replace(/^"|"$/g, '') || from || 'Unknown sender';
}
