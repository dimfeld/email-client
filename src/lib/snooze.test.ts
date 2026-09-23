import { describe, expect, it } from 'bun:test';
import { parseSnoozeText, snoozeOptions } from './snooze';

// Local times, so the tests do not depend on the time zone.
const wednesday = new Date(2026, 8, 23, 15, 0);

describe('snooze times', () => {
  it('offers later today, tomorrow, this weekend, and next week', () => {
    expect(snoozeOptions(wednesday)).toEqual([
      { label: 'Later today', until: new Date(2026, 8, 23, 18) },
      { label: 'Tomorrow', until: new Date(2026, 8, 24, 8) },
      { label: 'This weekend', until: new Date(2026, 8, 26, 8) },
      { label: 'Next week', until: new Date(2026, 8, 28, 8) },
    ]);
  });

  it('leaves out times that have passed or that are today', () => {
    const saturdayEvening = new Date(2026, 8, 26, 19, 0);
    expect(snoozeOptions(saturdayEvening).map((option) => option.label)).toEqual([
      'Tomorrow',
      'Next week',
    ]);
    const monday = new Date(2026, 8, 28, 9, 0);
    expect(snoozeOptions(monday).at(-1)?.until).toEqual(new Date(2026, 9, 5, 8));
  });

  it('reads natural language and rejects past or unknown times', () => {
    expect(parseSnoozeText('3 hours', wednesday)).toEqual(new Date(2026, 8, 23, 18, 0));
    expect(parseSnoozeText('tomorrow 9am', wednesday)).toEqual(new Date(2026, 8, 24, 9, 0));
    expect(parseSnoozeText('friday at 5pm', wednesday)).toEqual(new Date(2026, 8, 25, 17, 0));
    expect(parseSnoozeText('yesterday', wednesday)).toBeNull();
    expect(parseSnoozeText('soon-ish', wednesday)).toBeNull();
    expect(parseSnoozeText('  ', wednesday)).toBeNull();
  });
});
