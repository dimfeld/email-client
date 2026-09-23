import { parseDate } from 'chrono-node';

export type SnoozeOption = { label: string; until: Date };

function atHour(from: Date, days: number, hour: number): Date {
  const date = new Date(from);
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date;
}

/** The common snooze times. The choices and times are the same as in Gmail. */
export function snoozeOptions(now: Date): SnoozeOption[] {
  const options: SnoozeOption[] = [];
  const laterToday = atHour(now, 0, 18);
  if (laterToday > now) options.push({ label: 'Later today', until: laterToday });
  options.push({ label: 'Tomorrow', until: atHour(now, 1, 8) });
  const day = now.getDay();
  if (day !== 0 && day !== 6)
    options.push({ label: 'This weekend', until: atHour(now, 6 - day, 8) });
  options.push({ label: 'Next week', until: atHour(now, (8 - day) % 7 || 7, 8) });
  return options;
}

/** Reads a time such as "3 hours" or "friday 5pm". Returns null unless it is in the future. */
export function parseSnoozeText(text: string, now: Date): Date | null {
  if (!text.trim()) return null;
  const date = parseDate(text, now, { forwardDate: true });
  return date && date > now ? date : null;
}

export function formatSnoozeTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
