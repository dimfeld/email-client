<script lang="ts">
	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href="/icons/email-check.svg" type="image/svg+xml" />
	<link rel="apple-touch-icon" href="/icons/email-check-180.png" />
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
