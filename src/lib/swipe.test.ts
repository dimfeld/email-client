import { describe, expect, it } from 'bun:test';
import { clampSwipe, settleSwipe, type SwipeConfig } from './swipe';

const config: SwipeConfig = {
  left: { buttons: 2, long: true },
  right: { buttons: 0, long: true },
};

describe('swipe settling', () => {
  it('runs the long action past the tray and one more button', () => {
    expect(settleSwipe(-132, 44, config)).toEqual({ kind: 'run', side: 'left' });
    expect(settleSwipe(-131, 44, config)).toEqual({ kind: 'open', side: 'left' });
    expect(settleSwipe(44, 44, config)).toEqual({ kind: 'run', side: 'right' });
  });

  it('snaps a short release to the nearest rest position', () => {
    expect(settleSwipe(-44, 44, config)).toEqual({ kind: 'open', side: 'left' });
    expect(settleSwipe(-43, 44, config)).toEqual({ kind: 'close' });
    expect(settleSwipe(43, 44, config)).toEqual({ kind: 'close' });
  });

  it('ignores a disabled side and stops at the tray without a long action', () => {
    const noLong: SwipeConfig = { left: { buttons: 1, long: false }, right: null };
    expect(clampSwipe(30, 300, 44, noLong)).toBe(0);
    expect(settleSwipe(30, 44, noLong)).toEqual({ kind: 'close' });
    expect(clampSwipe(-200, 300, 44, noLong)).toBe(-44);
    expect(clampSwipe(-400, 300, 44, config)).toBe(-300);
  });
});
