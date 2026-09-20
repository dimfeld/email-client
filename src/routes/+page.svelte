<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { tick } from 'svelte';
	import { effectiveImportance } from '$lib/categories';
	import type { ActionData, PageData } from './$types';
	import type { StoredEmail } from '$lib/server/types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Filter = string;
	let labels = $derived(Object.fromEntries(data.categories.map((category) => [category.id, category.name])));
	let categoryLevels = $derived(new Map(data.categories.map((category) => [category.id, category.level])));
	function importance(email: StoredEmail) {
		return effectiveImportance(categoryLevels.get(email.category ?? ''), email.importance);
	}
	let activeFilter = $state<Filter>('all');
	let selectedId = $state<number | null>(null);
	let mobileDetail = $state(false);
	let showShortcuts = $state(false);
	let archiveForm = $state<HTMLFormElement | null>(null);
	let deleteForm = $state<HTMLFormElement | null>(null);
	let readingContent = $state<HTMLElement | null>(null);
	let useful = $derived(data.emails.filter((email) => (importance(email) === 'important' || importance(email) === 'useful')));
	let filters = $derived([
		{ category: 'all' as const, label: 'All mail', count: data.emails.length },
		{ category: 'important', label: 'All important', count: data.emails.filter((email) => importance(email) === 'important').length },
		{ category: 'useful' as const, label: 'Useful now', count: useful.length },
		...data.categories.map((category) => ({
			category: category.id,
			label: category.name,
			count: data.emails.filter((email) => email.category === category.id).length
		})),
		{ category: 'pending', label: 'Needs classification', count: data.emails.filter((email) => email.category === null).length }
	]);
	let visibleEmails = $derived(data.emails.filter((email) => {
		if (activeFilter === 'all') return true;
		if (activeFilter === 'useful') return (importance(email) === 'important' || importance(email) === 'useful');
		if (activeFilter === 'important') return importance(email) === 'important';
		return (email.category ?? 'pending') === activeFilter;
	}));
	let selectedEmail = $derived(visibleEmails.find((email) => email.id === selectedId) ?? visibleEmails[0] ?? null);
	let filterLabel = $derived(filters.find((filter) => filter.category === activeFilter)?.label ?? 'All mail');

	function selectFilter(filter: Filter) {
		activeFilter = filter;
		selectedId = null;
		mobileDetail = false;
	}

	function isHtml(body: string): boolean {
		return /<(?:html|body|div|p|table|br|a|span)\b[^>]*>/i.test(body);
	}

	function emailDocument(body: string): string {
		return `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; form-action 'none'; base-uri 'none'"><style>body{font:15px/1.6 system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style></head><body>${body}</body></html>`;
	}

	function senderName(from: string): string {
		return from.replace(/\s*<[^>]+>\s*$/, '').replace(/^"|"$/g, '') || from || 'Unknown sender';
	}

	function formatDate(value: string | null): string {
		if (!value) return 'Date unknown';
		const date = new Date(value);
		if (Number.isNaN(date.valueOf())) return value;
		return new Intl.DateTimeFormat(undefined, {
			month: 'short',
			day: 'numeric',
			year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric'
		}).format(date);
	}

	function confidence(email: StoredEmail): string | null {
		if (email.categoryConfidence === null) return null;
		return `${Math.round(email.categoryConfidence * 100)}%`;
	}

	function moveSelection(offset: number) {
		if (visibleEmails.length === 0) return;
		const currentIndex = selectedEmail ? visibleEmails.findIndex((email) => email.id === selectedEmail.id) : -1;
		const nextIndex = currentIndex < 0
			? offset > 0 ? 0 : visibleEmails.length - 1
			: Math.max(0, Math.min(visibleEmails.length - 1, currentIndex + offset));
		selectedId = visibleEmails[nextIndex].id;
		mobileDetail = true;
	}

	function isTypingTarget(target: EventTarget | null): boolean {
		return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName));
	}

	async function handleKeydown(event: KeyboardEvent) {
		if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
		if (showShortcuts && event.key !== 'Escape' && event.key !== '?') return;
		const key = event.key.toLowerCase();
		if (key === 'j') {
			event.preventDefault();
			moveSelection(1);
		} else if (key === 'k') {
			event.preventDefault();
			moveSelection(-1);
		} else if (key === 'e' && selectedEmail && archiveForm) {
			event.preventDefault();
			archiveForm.requestSubmit();
		} else if ((event.key === '#' || (event.shiftKey && event.code === 'Digit3')) && selectedEmail && deleteForm) {
			event.preventDefault();
			deleteForm.requestSubmit();
		} else if (key === 'o' || event.key === 'Enter') {
			if (selectedEmail) {
				event.preventDefault();
				mobileDetail = true;
				await tick();
				readingContent?.focus({ preventScroll: true });
			}
		} else if (key === 'u' || event.key === 'Escape') {
			event.preventDefault();
			if (showShortcuts) showShortcuts = false;
			else mobileDetail = false;
		} else if (event.key === '?') {
			event.preventDefault();
			showShortcuts = !showShortcuts;
		}
	}

	const submitMessageAction: SubmitFunction = () => async ({ result, update }) => {
		await update();
		if (result.type === 'success') {
			selectedId = null;
			mobileDetail = false;
		}
	};

	$effect(() => {
		window.addEventListener('keydown', handleKeydown);
		return () => window.removeEventListener('keydown', handleKeydown);
	});
</script>

<svelte:head>
	<title>Email Check — {data.selectedAccount ?? 'All accounts'}</title>
</svelte:head>

<main>
	<header class="masthead">
		<div class="brand"><span class="brand-mark" aria-hidden="true">@</span><h1>Email Check</h1></div>
		<a class="settings-link" href="/settings">Settings</a>
		<button class="shortcuts-button" type="button" onclick={() => { showShortcuts = true; }}>Shortcuts <kbd>?</kbd></button>
		<form method="GET" class="account-picker">
			<label for="account">Account</label>
			<select id="account" name="account" onchange={(event) => event.currentTarget.form?.submit()}>
				<option value="">All accounts</option>
				{#each data.accounts as account}
					<option value={account.email} selected={data.selectedAccount === account.email}>{account.email}</option>
				{/each}
			</select>
		</form>
	</header>

	<div class="mailbox" class:show-detail={mobileDetail}>
		<nav class="sidebar" aria-label="Mail categories">
			<p class="eyebrow">MAILBOX</p>
			{#each filters as filter}
				<button class="filter" class:active={activeFilter === filter.category} aria-pressed={activeFilter === filter.category} onclick={() => selectFilter(filter.category)}>
					<span class="filter-label">{filter.label}</span><span class="count">{filter.count}</span>
				</button>
			{/each}
		</nav>

		<section class="list-pane" aria-label="Message list">
			<header class="pane-heading"><h2>{filterLabel}</h2><span>{visibleEmails.length} messages</span></header>
			<div class="message-list">
				{#each visibleEmails as email (email.id)}
					<button class="message" class:selected={selectedEmail?.id === email.id} aria-pressed={selectedEmail?.id === email.id} onclick={() => { selectedId = email.id; mobileDetail = true; }}>
						<span class="message-top"><strong>{senderName(email.fromAddress)}</strong><time>{formatDate(email.messageDate)}</time></span>
						<span class="subject">{email.subject || '(No subject)'}</span>
						<span class="preview">{email.snippet || email.body || 'No preview text.'}</span>
						<span class="message-bottom"><span class="account">{email.accountEmail}</span>{#if (importance(email) === 'important' || importance(email) === 'useful')}<span class="useful-tag">{importance(email) === 'important' ? 'Important' : 'Useful'}</span>{/if}{#if email.classificationError}<span class="error-tag">Retry needed</span>{/if}</span>
					</button>
				{:else}
					<div class="empty-state">
						<h3>{data.accounts.length === 0 ? 'No accounts yet' : data.emails.length === 0 ? 'No downloaded email' : 'No messages here'}</h3>
						<p>{data.accounts.length === 0 ? 'Connect an account to see your mail.' : data.emails.length === 0 ? 'Messages will appear after your account syncs.' : 'Choose another category to see more mail.'}</p>
					</div>
				{/each}
			</div>
		</section>

		<section class="detail-pane" aria-label="Message detail">
			<header class="pane-heading detail-toolbar">
				<button class="back-button" onclick={() => { mobileDetail = false; }}>← Back to messages</button>
				<span>{selectedEmail ? (selectedEmail.category ? labels[selectedEmail.category] : 'Needs classification') : 'Message detail'}</span>
				{#if selectedEmail && importance(selectedEmail) !== null}<span class="useful-tag">{importance(selectedEmail) === 'important' ? 'Important' : importance(selectedEmail) === 'useful' ? 'Useful' : 'Other'}</span>{/if}
			</header>
			{#if selectedEmail}
				{#key selectedEmail.id}
					<article bind:this={readingContent} class="reading-content" tabindex="-1">
						<h2>{selectedEmail.subject || '(No subject)'}</h2>
						<dl class="message-metadata">
							<div><dt>From</dt><dd>{selectedEmail.fromAddress || 'Unknown sender'}</dd></div>
							<div><dt>To</dt><dd>{selectedEmail.toAddresses || 'Unknown recipient'}</dd></div>
							<div><dt>Account</dt><dd>{selectedEmail.accountEmail}</dd></div>
							<div><dt>Date</dt><dd>{selectedEmail.messageDate || 'Date unknown'}</dd></div>
						</dl>
						{#if confidence(selectedEmail)}<p class="classification">Category confidence: {confidence(selectedEmail)}</p>{/if}
						{#if selectedEmail.classificationError}<p class="notice">Classification failed. This message needs another attempt.</p>{/if}
						{#if form?.error}<p class="notice action-error" role="alert">{form.error}</p>{/if}
						<div class="message-actions">
							<form bind:this={archiveForm} method="POST" action="?/archive" use:enhance={submitMessageAction}>
								<input type="hidden" name="id" value={selectedEmail.id} />
								<button type="submit">Archive</button>
							</form>
							<form bind:this={deleteForm} method="POST" action="?/delete" use:enhance={submitMessageAction} onsubmit={(event) => { if (!window.confirm('Move this message to Gmail Trash?')) event.preventDefault(); }}>
								<input type="hidden" name="id" value={selectedEmail.id} />
								<button type="submit" class="delete-button">Delete</button>
							</form>
						</div>
						{#if isHtml(selectedEmail.body)}
							<iframe class="html-message" title="Email message content" sandbox="" referrerpolicy="no-referrer" srcdoc={emailDocument(selectedEmail.body)}></iframe>
						{:else}
							<div class="message-body">{selectedEmail.body || selectedEmail.snippet || 'No message text available.'}</div>
						{/if}
						{#if selectedEmail.bodyTruncated}<p class="notice">Only part of this message was downloaded.</p>{/if}
					</article>
				{/key}
			{:else}
				<div class="detail-empty"><span aria-hidden="true">@</span><h2>No message selected</h2><p>Choose a category and a message to read it here.</p></div>
			{/if}
		</section>
	</div>
	{#if showShortcuts}
		<div class="shortcut-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) showShortcuts = false; }}>
			<dialog open class="shortcut-dialog" aria-labelledby="shortcut-heading">
				<div class="shortcut-heading"><h2 id="shortcut-heading">Keyboard shortcuts</h2><button type="button" aria-label="Close keyboard shortcuts" onclick={() => { showShortcuts = false; }}>×</button></div>
				<dl>
					<div><dt><kbd>J</kbd></dt><dd>Next message</dd></div>
					<div><dt><kbd>K</kbd></dt><dd>Previous message</dd></div>
					<div><dt><kbd>E</kbd></dt><dd>Archive selected message</dd></div>
					<div><dt><kbd>#</kbd></dt><dd>Move selected message to Trash</dd></div>
					<div><dt><kbd>O</kbd> <kbd>Enter</kbd></dt><dd>Open selected message</dd></div>
					<div><dt><kbd>U</kbd> <kbd>Esc</kbd></dt><dd>Return to the message list</dd></div>
					<div><dt><kbd>?</kbd></dt><dd>Show or hide this list</dd></div>
				</dl>
			</dialog>
		</div>
	{/if}
</main>

<style>
	:global(*) { box-sizing: border-box; }
	:global(html) { background: #07131c; color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
	:global(body) { margin: 0; min-width: 320px; color: #edf7fb; }
	:global(button), :global(select) { font: inherit; }
	button { cursor: pointer; color: inherit; }
	button:focus-visible, select:focus-visible { outline: 2px solid #6edff3; outline-offset: -3px; }
	h1, h2, h3, p { margin: 0; }
	main { height: 100dvh; display: flex; flex-direction: column; }
	.masthead { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 16px 24px; border-bottom: 1px solid #23404e; }
	.brand { display: flex; align-items: center; gap: 12px; }
	.brand-mark { color: #6edff3; font-size: 1.7rem; }
	h1 { font-size: 1.25rem; letter-spacing: -.035em; white-space: nowrap; }
	.settings-link { margin-left: auto; color: #6edff3; font-size: .85rem; text-decoration: none; }
	.account-picker { display: flex; align-items: center; gap: 12px; min-width: 0; }
	.account-picker label { color: #8eabb8; font-size: .8rem; }
	.shortcuts-button { border: 0; background: transparent; color: #6edff3; font-size: .8rem; cursor: pointer; }
	kbd { display: inline-block; min-width: 1.5em; padding: 2px 5px; border: 1px solid #365869; border-radius: 3px; background: #102631; color: #d5e3e9; font: .75rem ui-monospace, SFMono-Regular, Menlo, monospace; text-align: center; }
	select { min-width: 0; max-width: 100%; border: 1px solid #365869; border-radius: 6px; padding: 8px 12px; background: #0d202b; color: #edf7fb; }
	.mailbox { flex: 1; min-height: 0; display: grid; grid-template-columns: 220px minmax(280px, 360px) minmax(0, 1fr); }
	.sidebar { padding: 24px 12px; overflow-y: auto; border-right: 1px solid #23404e; }
	.eyebrow { padding: 0 12px 16px; color: #7595a3; font-size: .7rem; font-weight: 700; letter-spacing: .14em; }
	.filter { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; text-align: left; border: 0; border-radius: 6px; padding: 12px; background: transparent; color: #a9c0cb; font-size: .85rem; }
	.filter:nth-of-type(3) { margin-bottom: 20px; }
	.filter:hover { background: #102631; }
	.filter.active { background: #193a49; color: #a3effb; font-weight: 650; }
	.filter-label { overflow-wrap: anywhere; }
	.count { font-size: .75rem; font-variant-numeric: tabular-nums; }
	.list-pane, .detail-pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
	.list-pane { border-right: 1px solid #23404e; background: #0b1c26; }
	.pane-heading { min-height: 68px; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid #23404e; }
	.pane-heading h2 { font-size: 1rem; }
	.pane-heading > span { color: #91adb9; font-size: .75rem; }
	.message-list { overflow-y: auto; flex: 1; }
	.message { display: block; width: 100%; padding: 20px; text-align: left; border: 0; border-bottom: 1px solid #203743; border-left: 3px solid transparent; background: transparent; }
	.message:hover { background: #102a37; }
	.message.selected { background: #153443; border-left-color: #6edff3; }
	.message-top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
	.message-top strong { font-size: .85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	time { flex-shrink: 0; color: #8eabb8; font-size: .7rem; }
	.subject { display: block; margin-top: 8px; font-size: .88rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.preview { display: -webkit-box; overflow: hidden; margin-top: 7px; color: #91adb9; font-size: .8rem; line-height: 1.5; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow-wrap: anywhere; }
	.message-bottom { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
	.account { min-width: 0; overflow-wrap: anywhere; color: #7595a3; font-size: .7rem; }
	.useful-tag, .error-tag { display: inline-block; border-radius: 4px; padding: 3px 6px; font-size: .65rem; font-weight: 700; }
	.useful-tag { background: #ffde5920; color: #ffde59; }
	.error-tag { background: #ff708d20; color: #ff9fb2; }
	.detail-pane { background: #0d202b; }
	.reading-content { padding: 32px; overflow-y: auto; overflow-wrap: anywhere; }
	.reading-content h2 { font-size: 1.6rem; line-height: 1.35; letter-spacing: -.025em; }
	.message-metadata { margin: 24px 0 12px; font-size: .8rem; line-height: 1.6; }
	.message-metadata > div { display: grid; grid-template-columns: 64px minmax(0, 1fr); margin-top: 4px; }
	dt { color: #7595a3; } dd { margin: 0; color: #bfd1d8; }
	.classification { color: #7595a3; font-size: .75rem; }
	.message-body { margin-top: 28px; padding-top: 28px; border-top: 1px solid #23404e; white-space: pre-wrap; line-height: 1.75; font-size: .92rem; color: #d5e3e9; }
	.html-message { display: block; width: 100%; height: 60dvh; margin-top: 28px; border: 0; background: white; color-scheme: light; }
	.notice { margin-top: 20px; color: #ffde59; font-size: .8rem; }
	.action-error { color: #ff9fb2; }
	.message-actions { display: flex; gap: 10px; margin-top: 20px; }
	.message-actions button { border: 1px solid #6edff3; border-radius: 4px; padding: 8px 14px; background: #6edff3; color: #07131c; font-size: .8rem; font-weight: 650; }
	.message-actions .delete-button { border-color: #a84c63; background: transparent; color: #ff9fb2; }
	.shortcut-backdrop { position: fixed; inset: 0; z-index: 10; display: grid; place-items: center; padding: 20px; background: #0009; }
	.shortcut-dialog { width: min(420px, 100%); padding: 24px; border: 1px solid #365869; border-radius: 8px; background: #0d202b; box-shadow: 0 20px 60px #0008; }
	.shortcut-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
	.shortcut-heading h2 { font-size: 1.1rem; }
	.shortcut-heading button { border: 0; background: transparent; color: #8eabb8; font-size: 1.5rem; cursor: pointer; }
	.shortcut-dialog dl { margin: 20px 0 0; }
	.shortcut-dialog dl > div { display: grid; grid-template-columns: 90px 1fr; align-items: center; gap: 12px; padding: 8px 0; border-top: 1px solid #23404e; }
	.shortcut-dialog dt { display: flex; gap: 4px; }
	.shortcut-dialog dd { margin: 0; color: #d5e3e9; font-size: .85rem; }
	.empty-state { padding: 32px 20px; } .empty-state h3 { font-size: 1rem; }
	.empty-state p, .detail-empty p { margin-top: 10px; color: #8eabb8; font-size: .85rem; line-height: 1.6; }
	.detail-empty { margin: auto; padding: 32px; text-align: center; }
	.detail-empty > span { display: block; margin-bottom: 20px; font-size: 3rem; color: #365869; }
	.detail-empty h2 { font-size: 1.2rem; }
	.back-button { display: none; background: transparent; border: 0; padding: 8px 0; color: #6edff3; font-size: .8rem; }
	@media (max-width: 1000px) {
		.mailbox { grid-template-columns: 180px 280px minmax(0, 1fr); }
		.sidebar { padding-inline: 6px; }
		.filter { padding-inline: 8px; font-size: .78rem; }
		.reading-content { padding: 24px; }
	}
	@media (max-width: 760px) {
		.masthead { padding: 12px 16px; flex-wrap: wrap; gap: 12px; }
		.account-picker { flex: 1; justify-content: flex-end; }
		.account-picker label { display: none; }
		.mailbox { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
		.sidebar { display: flex; overflow-x: auto; padding: 10px; border-right: 0; border-bottom: 1px solid #23404e; }
		.eyebrow { display: none; }
		.filter { width: auto; flex-shrink: 0; gap: 12px; padding: 10px 12px; }
		.filter:nth-of-type(3) { margin-bottom: 0; }
		.list-pane { border-right: 0; }
		.detail-pane { display: none; }
		.show-detail .list-pane { display: none; }
		.show-detail .detail-pane { display: flex; }
		.back-button { display: block; }
		.detail-toolbar { flex-wrap: wrap; }
	}
</style>
