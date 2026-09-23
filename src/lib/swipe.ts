// A row swiped to the left moves left and shows the actions on its right edge.
export type SwipeSide = 'left' | 'right';

/** The number of buttons on a side, and if a long swipe on that side runs an action. */
export type SwipeSideConfig = { buttons: number; long: boolean } | null;
export type SwipeConfig = Record<SwipeSide, SwipeSideConfig>;

export type SwipeSettle = { kind: 'close' } | { kind: 'open' | 'run'; side: SwipeSide };

function sideOf(offset: number): SwipeSide {
  return offset < 0 ? 'left' : 'right';
}

/** The distance past which a release runs the long action: the tray and one more button. */
export function longSwipeDistance(config: SwipeSideConfig, buttonWidth: number): number {
  return ((config?.buttons ?? 0) + 1) * buttonWidth;
}

/** Keeps a drag inside the row, and stops at the tray on a side without a long action. */
export function clampSwipe(
  offset: number,
  rowWidth: number,
  buttonWidth: number,
  config: SwipeConfig
): number {
  const side = config[sideOf(offset)];
  if (!side) return 0;
  const limit = side.long ? rowWidth : side.buttons * buttonWidth;
  return Math.sign(offset) * Math.min(Math.abs(offset), limit);
}

/** Where a released row goes: the long action, the open tray, or closed. */
export function settleSwipe(offset: number, buttonWidth: number, config: SwipeConfig): SwipeSettle {
  const side = sideOf(offset);
  const sideConfig = config[side];
  const distance = Math.abs(offset);
  if (!sideConfig || distance === 0) return { kind: 'close' };
  if (sideConfig.long && distance >= longSwipeDistance(sideConfig, buttonWidth))
    return { kind: 'run', side };
  // A shorter release goes to the nearest rest position: closed or the open tray.
  const tray = sideConfig.buttons * buttonWidth;
  if (tray > 0 && distance >= tray / 2) return { kind: 'open', side };
  return { kind: 'close' };
}
