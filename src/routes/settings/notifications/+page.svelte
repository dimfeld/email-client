<script lang="ts">
  import { onMount } from 'svelte';
  import {
    currentPushSubscription,
    disablePush,
    enablePush,
    pushSupport,
  } from '$lib/push-subscription';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  type Status = 'loading' | 'unsupported' | 'needs-install' | 'denied' | 'enabled' | 'disabled';
  let status = $state<Status>('loading');
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function readStatus(): Promise<Status> {
    const support = pushSupport();
    if (support !== 'supported') return support;
    if (Notification.permission === 'denied') return 'denied';
    return (await currentPushSubscription()) ? 'enabled' : 'disabled';
  }

  onMount(() => {
    readStatus().then((value) => (status = value));
  });

  async function run(action: () => Promise<unknown>) {
    busy = true;
    error = null;
    try {
      await action();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      status = await readStatus();
      busy = false;
    }
  }
</script>

<section aria-labelledby="notifications-heading">
  <h2 id="notifications-heading">Notifications</h2>
  <p class="help">
    This device gets a notification for each new unread inbox message that Jev marks important or
    useful. The app icon badge shows the number of notifications since you last opened the app.
  </p>
  <div class="sync-card">
    <div>
      <strong>This device</strong>
      <p>
        {#if !data.vapidPublicKey}
          The server has no VAPID keys. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT.
        {:else if status === 'loading'}
          Checking…
        {:else if status === 'needs-install'}
          On iPhone and iPad, add Email Check to the Home Screen, then open it from there.
        {:else if status === 'unsupported'}
          This browser does not support push notifications.
        {:else if status === 'denied'}
          Notifications are blocked. Allow them in the system settings for this app.
        {:else if status === 'enabled'}
          Notifications are on.
        {:else}
          Notifications are off.
        {/if}
      </p>
      {#if error}<p class="error-text">{error}</p>{/if}
    </div>
    {#if data.vapidPublicKey && status === 'disabled'}
      <button
        type="button"
        disabled={busy}
        onclick={() => run(() => enablePush(data.vapidPublicKey!))}>Turn on</button
      >
    {:else if status === 'enabled'}
      <button type="button" class="remove" disabled={busy} onclick={() => run(disablePush)}
        >Turn off</button
      >
    {/if}
  </div>
</section>

<style>
  .error-text {
    color: var(--color-danger);
  }
</style>
