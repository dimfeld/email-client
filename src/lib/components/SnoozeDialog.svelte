<script lang="ts">
  import Icon from './Icon.svelte';
  import { formatSnoozeTime, parseSnoozeText, snoozeOptions } from '$lib/snooze';

  let { onSnooze, onClose }: { onSnooze: (until: Date) => void; onClose: () => void } = $props();

  const now = new Date();
  const options = snoozeOptions(now);
  let dialog = $state<HTMLDialogElement | null>(null);
  let text = $state('');
  let typed = $derived(parseSnoozeText(text, new Date()));
  let showCustom = $state(false);
  let custom = $state(
    localInputValue(options.find((option) => option.label === 'Tomorrow')!.until)
  );
  let customDate = $derived.by(() => {
    const date = new Date(custom);
    return Number.isNaN(date.valueOf()) || date <= new Date() ? null : date;
  });

  // The value format of a datetime-local input, in local time.
  function localInputValue(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
      date.getHours()
    )}:${pad(date.getMinutes())}`;
  }

  function choose(until: Date) {
    dialog?.close();
    onSnooze(until);
  }
</script>

<!-- A click on the dialog element itself is a click on its backdrop. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialog}
  {@attach (element: HTMLDialogElement) => element.showModal()}
  class="snooze-dialog"
  aria-labelledby="snooze-heading"
  onclose={onClose}
  onclick={(event) => {
    if (event.target === event.currentTarget) dialog?.close();
  }}
>
  <div class="snooze-heading">
    <h2 id="snooze-heading">Snooze until</h2>
    <button type="button" class="close" aria-label="Close" onclick={() => dialog?.close()}
      ><Icon name="close" size="1.25rem" /></button
    >
  </div>
  <form
    class="snooze-text"
    onsubmit={(event) => {
      event.preventDefault();
      if (typed) choose(typed);
    }}
  >
    <input
      bind:value={text}
      aria-label="Snooze time"
      aria-describedby="snooze-typed"
      placeholder={'For example "3 hours" or "friday 5pm"'}
      enterkeyhint="done"
    />
    <p id="snooze-typed" class="typed" aria-live="polite">
      {#if typed}<button type="submit">{formatSnoozeTime(typed)}</button>{:else if text.trim()}Time
        not recognized{/if}
    </p>
  </form>
  <ul>
    {#each options as option, index (option.label)}
      <li>
        <!-- Focus starts on the first time, so a phone keyboard does not cover the list. -->
        <!-- svelte-ignore a11y_autofocus -->
        <button type="button" autofocus={index === 0} onclick={() => choose(option.until)}
          ><span>{option.label}</span><time>{formatSnoozeTime(option.until)}</time></button
        >
      </li>
    {/each}
    <li>
      <button type="button" aria-expanded={showCustom} onclick={() => (showCustom = !showCustom)}
        ><span>Custom date and time</span></button
      >
    </li>
  </ul>
  {#if showCustom}
    <form
      class="custom"
      onsubmit={(event) => {
        event.preventDefault();
        if (customDate) choose(customDate);
      }}
    >
      <input
        type="datetime-local"
        aria-label="Custom snooze time"
        min={localInputValue(now)}
        bind:value={custom}
      />
      <button type="submit" class="primary" disabled={!customDate}>Snooze</button>
    </form>
  {/if}
</dialog>

<style>
  .snooze-dialog {
    width: min(380px, calc(100% - 32px));
    padding: 20px;
    color: inherit;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    box-shadow: 0 20px 60px var(--color-shadow);
  }
  .snooze-dialog::backdrop {
    background: var(--color-backdrop);
  }
  .snooze-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  h2 {
    margin: 0;
    font-size: 1.1rem;
  }
  button {
    cursor: pointer;
    color: inherit;
  }
  .close {
    border: 0;
    background: transparent;
    color: var(--color-text-muted);
  }
  input {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    color: var(--color-text);
    font-size: var(--text-sm);
  }
  .snooze-text {
    margin-top: 14px;
  }
  .typed {
    min-height: 1.5em;
    margin: 6px 0 0;
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }
  .typed button {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-accent-text);
    font-size: var(--text-xs);
    font-weight: 650;
  }
  ul {
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
  }
  li + li {
    border-top: 1px solid var(--color-border);
  }
  ul button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 12px 4px;
    border: 0;
    background: transparent;
    font-size: var(--text-sm);
    text-align: left;
  }
  ul button:hover {
    background: var(--color-surface-hover);
  }
  ul time {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }
  .custom {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .primary {
    flex: none;
    padding: 8px 14px;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--color-accent);
    color: var(--color-on-accent);
    font-size: var(--text-sm);
    font-weight: 650;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }
</style>
