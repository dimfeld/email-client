<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Email Check</title>
	<meta
		name="description"
		content="A local Gmail inbox that uses Jev to sort useful email by category."
	/>
</svelte:head>

{@render children()}
