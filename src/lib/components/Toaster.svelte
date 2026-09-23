<script lang="ts">
  import { dismissToast, toasts } from '$lib/toast.svelte';
  import Icon from './Icon.svelte';
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each toasts as toast (toast.id)}
    <div class="toast" class:error={toast.tone === 'error'}>
      <span>{toast.message}</span>
      {#if toast.action}
        {@const action = toast.action}
        <button
          class="toast-action"
          onclick={() => {
            dismissToast(toast.id);
            action.run();
          }}>{action.label}</button
        >
      {/if}
      <button
        class="toast-close"
        aria-label="Close notification"
        onclick={() => dismissToast(toast.id)}><Icon name="close" /></button
      >
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    bottom: 16px;
    left: 16px;
    z-index: 30;
    display: grid;
    gap: 8px;
    max-width: calc(100vw - 32px);
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 8px 8px 14px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
    box-shadow: 0 8px 24px var(--color-shadow);
    font-size: var(--text-sm);
  }
  .toast.error {
    border-color: var(--color-danger-border);
    color: var(--color-danger);
  }
  button {
    border: 0;
    background: none;
    cursor: pointer;
  }
  .toast-action {
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    color: var(--color-accent);
    font-weight: 650;
  }
  .toast-action:hover {
    background: var(--color-accent-bg-subtle);
  }
  .toast-close {
    padding: 4px;
    color: var(--color-text-muted);
  }
</style>
