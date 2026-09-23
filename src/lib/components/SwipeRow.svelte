<script lang="ts" module>
  import type { IconName } from './Icon.svelte';

  export type SwipeAction = {
    label: string;
    icon: IconName;
    tone: 'archive' | 'delete' | 'star' | 'snooze';
    run: () => void;
  };
  /** The tray buttons of a side, from the row edge inward, and the long-swipe action. */
  export type SwipeActions = { buttons: SwipeAction[]; long?: SwipeAction } | null;
</script>

<script lang="ts">
  import Icon from './Icon.svelte';
  import type { Snippet } from 'svelte';
  import {
    clampSwipe,
    longSwipeDistance,
    settleSwipe,
    type SwipeConfig,
    type SwipeSide,
  } from '$lib/swipe';

  let {
    left,
    right,
    open,
    onOpenChange,
    children,
  }: {
    left: SwipeActions;
    right: SwipeActions;
    open: SwipeSide | null;
    onOpenChange: (side: SwipeSide | null) => void;
    children: Snippet;
  } = $props();

  let rowWidth = $state(0);
  // Tray buttons are square, so a button is as wide as the row is high.
  let buttonWidth = $state(0);
  let drag = $state<number | null>(null);
  let start: { x: number; y: number; base: number; pointerId: number; horizontal: boolean } | null =
    null;
  let suppressClick = false;

  let config: SwipeConfig = $derived({
    left: left && { buttons: left.buttons.length, long: Boolean(left.long) },
    right: right && { buttons: right.buttons.length, long: Boolean(right.long) },
  });
  let restOffset = $derived(
    open === 'left'
      ? -(left?.buttons.length ?? 0) * buttonWidth
      : open === 'right'
        ? (right?.buttons.length ?? 0) * buttonWidth
        : 0
  );
  let offset = $derived(drag ?? restOffset);
  let side = $derived<SwipeSide | null>(offset < 0 ? 'left' : offset > 0 ? 'right' : null);
  let actions = $derived(side === 'left' ? left : side === 'right' ? right : null);
  let armed = $derived(
    side !== null &&
      Boolean(actions?.long) &&
      Math.abs(offset) >= longSwipeDistance(config[side], buttonWidth)
  );

  // Mouse users have the message actions and shortcuts, so only touch and pen swipe.
  function pointerDown(event: PointerEvent) {
    suppressClick = false;
    if (event.pointerType === 'mouse' || !event.isPrimary) return;
    if ((event.target as Element).closest('.tray')) return;
    start = {
      x: event.clientX,
      y: event.clientY,
      base: restOffset,
      pointerId: event.pointerId,
      horizontal: false,
    };
  }

  function pointerMove(event: PointerEvent) {
    if (!start || event.pointerId !== start.pointerId) return;
    const dx = event.clientX - start.x;
    if (!start.horizontal) {
      // A vertical move is a scroll. The browser takes it and cancels the pointer.
      if (Math.abs(event.clientY - start.y) > Math.abs(dx)) {
        start = null;
        return;
      }
      if (dx === 0) return;
      start.horizontal = true;
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
    }
    drag = clampSwipe(start.base + dx, rowWidth, buttonWidth, config);
  }

  function pointerUp(event: PointerEvent) {
    if (!start || event.pointerId !== start.pointerId) return;
    const { base, horizontal } = start;
    start = null;
    const result = horizontal
      ? settleSwipe(drag ?? 0, buttonWidth, config)
      : ({ kind: 'close' } as const);
    drag = null;
    // A tap on an open row closes it. It does not open the message.
    suppressClick = base !== 0 || result.kind !== 'close';
    if (result.kind === 'open') onOpenChange(result.side);
    else onOpenChange(null);
    if (result.kind === 'run') (result.side === 'left' ? left : right)?.long?.run();
  }

  function pointerCancel() {
    start = null;
    drag = null;
  }

  function clickCapture(event: MouseEvent) {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  }
</script>

<!-- Swipes are a touch shortcut. The message actions and keyboard shortcuts do the same work. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="swipe-row"
  bind:clientWidth={rowWidth}
  bind:clientHeight={buttonWidth}
  onpointerdown={pointerDown}
  onpointermove={pointerMove}
  onpointerup={pointerUp}
  onpointercancel={pointerCancel}
  onclickcapture={clickCapture}
>
  {#if side && actions}
    <div class={['tray', side]} style:width="{Math.abs(offset)}px">
      {#if (armed || actions.buttons.length === 0) && actions.long}
        <div class={['tray-action', actions.long.tone, !armed && 'pending']} aria-hidden="true">
          <Icon name={actions.long.icon} size="1.25rem" />
        </div>
      {:else}
        {#each actions.buttons as action (action.label)}
          <button
            type="button"
            class={['tray-action', action.tone]}
            aria-label={action.label}
            title={action.label}
            onclick={() => {
              onOpenChange(null);
              action.run();
            }}><Icon name={action.icon} size="1.25rem" /></button
          >
        {/each}
      {/if}
    </div>
  {/if}
  <div
    class="swipe-content"
    class:dragging={drag !== null}
    style:transform={offset ? `translateX(${offset}px)` : undefined}
  >
    {@render children()}
  </div>
</div>

<style>
  .swipe-row {
    position: relative;
    overflow: hidden;
    /* The browser scrolls the list vertically. Horizontal moves come here as a swipe. */
    touch-action: pan-y;
  }
  .swipe-content {
    position: relative;
    background: var(--color-surface);
    transition: transform var(--motion-fast) ease-out;
  }
  .swipe-content.dragging {
    transition: none;
  }
  .tray {
    position: absolute;
    inset-block: 0;
    display: flex;
  }
  /* The first button is at the row edge. */
  .tray.left {
    right: 0;
    flex-direction: row-reverse;
  }
  .tray.right {
    left: 0;
  }
  .tray-action {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    color: var(--color-on-accent);
    cursor: pointer;
  }
  .tray.left > div.tray-action {
    justify-content: flex-end;
    padding-inline-end: 16px;
  }
  .tray.right > div.tray-action {
    justify-content: flex-start;
    padding-inline-start: 16px;
  }
  .tray-action.pending {
    background: var(--color-surface-raised);
    color: var(--color-text-muted);
  }
  .archive {
    background: var(--color-accent);
  }
  .delete {
    background: var(--color-danger-strong);
  }
  .star {
    background: var(--color-star);
  }
  .snooze {
    background: var(--color-caution);
  }
  @media (prefers-reduced-motion: reduce) {
    .swipe-content {
      transition: none;
    }
  }
</style>
