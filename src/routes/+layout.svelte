<script lang="ts">
  import '../app.css';
  import { handleAppLinkShortcut } from '$lib/components/AppMasthead.svelte';
  import ComposerHost from '$lib/components/ComposerHost.svelte';
  import EmailChat from '$lib/components/EmailChat.svelte';
  import Toaster from '$lib/components/Toaster.svelte';
  import { chatContextKey, type ChatContext } from '$lib/chat-context';
  import { page } from '$app/state';
  import type { LayoutData } from './$types';
  import type { Snippet } from 'svelte';
  import { onMount, setContext } from 'svelte';
  import { afterNavigate, beforeNavigate, invalidate, refreshAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { createStateRefresh } from '$lib/state-refresh';
  import { parseStateScopes, type StateScope } from '$lib/state-scopes';
  import { dispatchStateChange } from '$lib/state-change';
  import { clearBadgeCount } from '$lib/push-badge';
  import { connectPush, enablePush } from '$lib/push-subscription';
  import { showToast } from '$lib/toast.svelte';

  // Load functions declare `depends('app:<scope>')`. Pages with remote queries listen for the
  // state change event. `all` refreshes everything, for example after a reconnect.
  const refresh = createStateRefresh(async (scopes) => {
    if (scopes.has('all')) return refreshAll();
    await Promise.all([
      invalidate((url) => url.protocol === 'app:' && scopes.has(url.pathname as StateScope)),
      dispatchStateChange(scopes),
    ]);
  });
  // A refresh of the old URL can cancel an active SvelteKit navigation.
  beforeNavigate(() => refresh.pause());
  afterNavigate(() => refresh.resume());
  onMount(() => {
    const events = new EventSource(resolve('/api/events'));
    const onMessage = (event: MessageEvent<string>) =>
      refresh.request(parseStateScopes(event.data));
    // The event stream sends `all` when it reconnects, so focus needs no refresh of its own.
    const onOnline = () => refresh.request(['all']);
    const onDrafts = () => refresh.request(['drafts']);
    // The badge counts notifications since the app was last focused.
    const clearBadge = () => {
      if (document.visibilityState === 'visible' && document.hasFocus())
        clearBadgeCount().catch((error) => console.error('The app badge was not cleared.', error));
    };
    clearBadge();
    // Notifications are on by default, but iOS lets only a tap request permission.
    const pushKey = data.vapidPublicKey;
    connectPush(pushKey)
      .then((result) => {
        if (result !== 'needs-tap' || !pushKey) return;
        showToast('Get notifications for important email and reminders.', {
          action: {
            label: 'Turn on',
            run: () =>
              void enablePush(pushKey).catch((error) =>
                showToast(`Notifications were not turned on. ${error}`, { tone: 'error' })
              ),
          },
        });
      })
      .catch((error) => console.error('The push subscription was not sent.', error));
    // A popover closes on a click outside it, but a click in a message frame stays in the frame.
    // The click moves focus into the frame, so close the open popovers then.
    const closePopoversForFrame = () => {
      if (!(document.activeElement instanceof HTMLIFrameElement)) return;
      for (const popover of document.querySelectorAll<HTMLElement>('[popover]:popover-open'))
        popover.hidePopover();
    };
    document.addEventListener('visibilitychange', clearBadge);
    window.addEventListener('focus', clearBadge);
    window.addEventListener('blur', closePopoversForFrame);
    events.addEventListener('message', onMessage);
    window.addEventListener('online', onOnline);
    window.addEventListener('email:state', onDrafts);
    return () => {
      refresh.stop();
      events.close();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('email:state', onDrafts);
      document.removeEventListener('visibilitychange', clearBadge);
      window.removeEventListener('focus', clearBadge);
      window.removeEventListener('blur', closePopoversForFrame);
    };
  });

  let { children, data }: { children: Snippet; data: LayoutData } = $props();
  const chat = $state<ChatContext>({
    open: false,
    account: null,
    currentMessageId: null,
    currentItem: null,
  });
  setContext(chatContextKey, chat);

  $effect(() => {
    const path = page.url.pathname;
    const itemKind = path === '/notes' ? 'note' : path === '/todos' ? 'todo' : null;
    const requestedItemId = itemKind ? Number(page.url.searchParams.get(itemKind)) : NaN;
    chat.currentItem =
      itemKind && Number.isInteger(requestedItemId) && requestedItemId > 0
        ? { kind: itemKind, id: requestedItemId }
        : null;
    if (path !== '/') {
      chat.currentMessageId = null;
      return;
    }
    const requestedAccount = page.url.searchParams.get('account');
    chat.account = data.composer.accounts.some((account) => account.email === requestedAccount)
      ? requestedAccount
      : null;
    const requestedId = Number(page.url.searchParams.get('message'));
    chat.currentMessageId = Number.isInteger(requestedId) && requestedId > 0 ? requestedId : null;
  });

  function handleChatShortcut(event: KeyboardEvent) {
    if (
      event.key !== '`' ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.repeat ||
      (event.target instanceof Element &&
        (event.target.closest('input, textarea, select, [contenteditable="true"]') ||
          event.target.closest('a[href]')))
    )
      return;
    event.preventDefault();
    chat.open = !chat.open;
  }
</script>

<svelte:head>
  <link rel="icon" href="/icons/email-check-32.png" type="image/png" sizes="32x32" />
  <link rel="apple-touch-icon" href="/icons/email-check-180.png" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <meta name="theme-color" content="#0b0b0d" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="Email Check" />
  <title>Email Check</title>
  <meta
    name="description"
    content="A local Gmail inbox that uses Jev to sort useful email by category."
  />
</svelte:head>

<svelte:window
  onkeydown={(event) => {
    handleAppLinkShortcut(event);
    handleChatShortcut(event);
  }}
/>

<div class="app-shell">
  <div class="page-content">{@render children()}</div>
  {#if chat.open}
    <div class="chat-panel">
      {#key chat.account}<EmailChat
          account={chat.account}
          currentMessageId={chat.currentMessageId}
          currentItem={chat.currentItem}
          close={() => (chat.open = false)}
        />{/key}
    </div>
  {/if}
</div>
<ComposerHost data={data.composer} />
<Toaster />

<style>
  .app-shell {
    display: flex;
    min-width: 0;
    padding-top: var(--app-inset-top, 0px);
  }
  .page-content {
    flex: 1;
    min-width: 0;
  }
  .chat-panel {
    position: sticky;
    top: 0;
    display: flex;
    flex: 0 0 min(420px, 34vw);
    height: 100dvh;
    min-width: 0;
  }
  .chat-panel :global(.chat) {
    flex: 1;
  }
  @media (max-width: 760px) {
    .chat-panel {
      position: fixed;
      inset: var(--app-inset-top, 0px) 0 0;
      z-index: 8;
      width: 100vw;
      height: calc(100dvh - var(--app-inset-top, 0px));
    }
  }
</style>
