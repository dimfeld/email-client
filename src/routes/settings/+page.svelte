<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let rows = $derived([
		...data.categories,
		{ id: '', name: '', description: '', level: 'auto' }
	].map((category) => form?.values?.id === category.id ? form.values : category));
</script>

<svelte:head><title>Settings — Email Check</title></svelte:head>

<main>
	<header>
		<a class="back" href="/">← Back to mail</a>
		<h1>Settings</h1>
		<p>Set the categories that Jev uses to sort mail across all accounts.</p>
	</header>
	<section aria-labelledby="categories-heading">
		<h2 id="categories-heading">Categories</h2>
		<p class="help">Jev uses each category name and description when it classifies a message. Changes apply to future classifications. Existing messages keep their category.</p>
		<p class="help"><strong>All important</strong> shows Important messages. <strong>Useful now</strong> shows Important and Useful messages. Fixed levels apply to all messages in the category.</p>
		<p class="help">With Auto, Jev chooses Important, Useful, or Other for each message. Existing messages without a result need another sync.</p>
		{#if form?.error}<p class="feedback error" role="alert">{form.error}</p>{/if}
		{#if form?.message}<p class="feedback" role="status">{form.message}</p>{/if}
		{#each rows as category (category)}
			<form method="POST" action="?/save" use:enhance class="category-card" aria-label={category.id ? `Edit ${category.name}` : 'Add category'}>
				<input type="hidden" name="id" value={category.id} />
				<div class="card-heading"><h3>{category.id ? category.name : 'Add category'}</h3><span class="badge">{category.level === 'important' ? 'Important' : category.level === 'useful' ? 'Useful' : category.level === 'auto' ? 'Auto' : 'Other'}</span></div>
				<label for={`name-${category.id}`}>Name</label>
				<input id={`name-${category.id}`} name="name" value={category.name} required />
				<label for={`description-${category.id}`}>Description</label>
				<textarea id={`description-${category.id}`} name="description" required rows="3">{category.description}</textarea>
				<label for={`level-${category.id}`}>Level</label>
				<select id={`level-${category.id}`} name="level">
					<option value="important" selected={category.level === 'important'}>Important</option>
					<option value="useful" selected={category.level === 'useful'}>Useful</option>
					<option value="other" selected={category.level === 'other'}>Other</option>
					<option value="auto" selected={category.level === 'auto'}>Auto — let Jev decide</option>
				</select>
				<div class="actions">
					<button type="submit">{category.id ? 'Save category' : 'Add category'}</button>
					{#if category.id}<button type="submit" class="remove" formaction="?/remove" formnovalidate>Remove category</button>{/if}
				</div>
				{#if category.id}<p class="remove-help">If you remove this category, its messages will move to Needs classification.</p>{/if}
			</form>
		{/each}
	</section>
</main>

<style>
	:global(*) { box-sizing: border-box; }
	:global(html) { background: #07131c; color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
	:global(body) { margin: 0; min-width: 320px; color: #edf7fb; }
	main { max-width: 860px; margin: auto; padding: 32px 24px 64px; }
	header { padding-bottom: 28px; border-bottom: 1px solid #23404e; margin-bottom: 28px; }
	.back { color: #6edff3; text-decoration: none; font-size: .9rem; }
	h1 { margin: 24px 0 10px; font-size: 2rem; }
	h2 { margin: 0 0 12px; font-size: 1.3rem; }
	h3 { margin: 0; font-size: 1.05rem; overflow-wrap: anywhere; }
	p { color: #9bb4bf; line-height: 1.6; margin: 0; }
	.help { margin-bottom: 12px; font-size: .9rem; }
	.category-card { padding: 24px; margin-top: 20px; background: #0d202b; border: 1px solid #23404e; border-radius: 8px; }
	.card-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
	.badge { background: #ffde5920; color: #ffde59; padding: 4px 8px; border-radius: 4px; font-size: .7rem; }
	label { display: block; font-size: .85rem; margin: 16px 0 8px; color: #bfd1d8; }
	input, textarea, select, button { font: inherit; }
	input:not([type="hidden"]), textarea, select { width: 100%; padding: 10px 12px; background: #07131c; color: #edf7fb; border: 1px solid #365869; border-radius: 4px; }
	textarea { resize: vertical; line-height: 1.5; }
	.actions { margin-top: 20px; display: flex; gap: 12px; flex-wrap: wrap; }
	button { cursor: pointer; border: 1px solid #6edff3; background: #6edff3; color: #07131c; padding: 10px 16px; border-radius: 4px; font-size: .85rem; font-weight: 600; }
	button.remove { border-color: #365869; background: transparent; color: #ffa3b5; }
	.remove-help { margin-top: 14px; font-size: .75rem; }
	.feedback { padding: 14px 16px; border: 1px solid #365869; color: #a3effb; margin-top: 20px; border-radius: 4px; }
	.error { color: #ffa3b5; }
	:focus-visible { outline: 2px solid #6edff3; outline-offset: 3px; }
	@media (max-width: 760px) { main { padding: 24px 16px; } .category-card { padding: 18px; } }
</style>
