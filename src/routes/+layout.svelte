<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { createStateRefresh } from '$lib/state-refresh';

	onMount(() => {
		const refresh = createStateRefresh(() => invalidate('app:state'));
		const events = new EventSource(resolve('/api/events'));
		events.addEventListener('message', refresh.request);
		window.addEventListener('focus', refresh.request);
		window.addEventListener('online', refresh.request);
		return () => {
			refresh.stop();
			events.close();
			window.removeEventListener('focus', refresh.request);
			window.removeEventListener('online', refresh.request);
		};
	});

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href="/icons/mail-factory.svg" type="image/svg+xml" />
	<link rel="apple-touch-icon" href="/icons/mail-factory-180.png" />
	<link rel="manifest" href="/manifest.webmanifest" />
	<meta name="theme-color" content="#07131c" />
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
