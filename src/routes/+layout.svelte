<script lang="ts">
  import '../app.css';
  import ComposerHost from '$lib/components/ComposerHost.svelte';
  import Toaster from '$lib/components/Toaster.svelte';
  import type { LayoutData } from './$types';
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { afterNavigate, beforeNavigate, refreshAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { createStateRefresh } from '$lib/state-refresh';

  const refresh = createStateRefresh(() => refreshAll());
  // A refresh of the old URL can cancel an active SvelteKit navigation.
  beforeNavigate(() => refresh.pause());
  afterNavigate(() => refresh.resume());
  onMount(() => {
    const events = new EventSource(resolve('/api/events'));
    events.addEventListener('message', refresh.request);
    window.addEventListener('focus', refresh.request);
    window.addEventListener('online', refresh.request);
    window.addEventListener('email:state', refresh.request);
    return () => {
      refresh.stop();
      events.close();
      window.removeEventListener('focus', refresh.request);
      window.removeEventListener('online', refresh.request);
      window.removeEventListener('email:state', refresh.request);
    };
  });

  let { children, data }: { children: Snippet; data: LayoutData } = $props();
</script>

<svelte:head>
  <link rel="icon" href="/icons/mail-factory.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="/icons/mail-factory-180.png" />
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

{@render children()}
<ComposerHost data={data.composer} />
<Toaster />
