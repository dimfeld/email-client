<script lang="ts">
	import { openComposer } from '$lib/composer';
	import EmailChat from '$lib/components/EmailChat.svelte';
	import CalendarRail from '$lib/components/CalendarRail.svelte';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { tick } from 'svelte';
	import { effectiveImportance } from '$lib/categories';
	import { buildEmailDocument, hasRemoteImages } from '$lib/email-html';
	import type { ActionData, PageData } from './$types';
	import type { StoredEmail } from '$lib/server/types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Filter = string;
	let labels = $derived(Object.fromEntries(data.categories.map((category) => [category.id, category.name])));
	let categoryLevels = $derived(new Map(data.categories.map((category) => [category.id, category.level])));
	let currentUrl = $derived(page.url.href);
	function importance(email: StoredEmail) {
		return effectiveImportance(categoryLevels.get(email.category ?? ''), email.importance);
	}
	let activeFilter = $derived.by(() => {
		const requested = new URL(currentUrl).searchParams.get('category') ?? 'all';
		return filters.some((filter) => filter.category === requested) ? requested : 'all';
	});
	let selectedId = $derived.by(() => {
		const requested = new URL(currentUrl).searchParams.get('message');
		const id = requested ? Number(requested) : NaN;
		return Number.isInteger(id) && id > 0 ? id : null;
	});
	let mobileDetail = $derived(new URL(currentUrl).searchParams.has('message'));
	let showChat = $state(false);
	let showCategories = $state(false);
	let showShortcuts = $state(false);
	let archiveForm = $state<HTMLFormElement | null>(null);
	let deleteForm = $state<HTMLFormElement | null>(null);
	let readingContent = $state<HTMLElement | null>(null);
	let remoteImagesFor = $state<number | null>(null);
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
	let selectedEmail = $derived(selectedId === null
		? null
		: data.selectedMessage ?? null);
	let filterLabel = $derived(filters.find((filter) => filter.category === activeFilter)?.label ?? 'All mail');

	function updateMailboxUrl(changes: { category?: Filter; message?: number | null }) {
		const url = new URL(currentUrl);
		if (changes.category !== undefined) {
			if (changes.category === 'all') url.searchParams.delete('category');
			else url.searchParams.set('category', changes.category);
		}
		if (changes.message !== undefined) {
			if (changes.message === null) url.searchParams.delete('message');
			else url.searchParams.set('message', String(changes.message));
		}
		if (url.href !== currentUrl) void goto(`${url.pathname}${url.search}${url.hash}`, { keepFocus: true, noScroll: true });
	}

	function selectFilter(filter: Filter) {
		updateMailboxUrl({ category: filter, message: null });
	}

	function resizeHtmlMessage(event: Event) {
		const frame = event.currentTarget as HTMLIFrameElement;
		try {
			frame.style.height = '0px';
			const document = frame.contentDocument;
			if (document) frame.style.height = `${document.documentElement.scrollHeight}px`;
		} catch {
			frame.style.removeProperty('height');
		}
	}

	function senderName(from: string): string {
		return from.replace(/\s*<[^>]+>\s*$/, '').replace(/^"|"$/g, '') || from || 'Unknown sender';
	}

	function formatDate(value: string | null): string {
		if (!value) return 'Date unknown';
		const date = new Date(value);
		if (Number.isNaN(date.valueOf())) return value;
		const now = new Date();
		if (date.toDateString() === now.toDateString()) {
			return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
		}
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

	function probability(value: number | null): string | null {
		if (value === null) return null;
		return `${Math.round(value * 100)}%`;
	}

	function jevAnswer(value: boolean | null, probabilityValue: number | null): string | null {
		if (value === null || probabilityValue === null) return null;
		return `${value ? 'Yes' : 'No'} (${probability(probabilityValue)})`;
	}

	function extractedDate(value: string | null): string | null {
		if (!value) return null;
		const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
		const date = new Date(dateOnly ? `${value}T00:00:00Z` : value);
		if (Number.isNaN(date.valueOf())) return value;
		return new Intl.DateTimeFormat(undefined, dateOnly
			? { dateStyle: 'medium', timeZone: 'UTC' }
			: { dateStyle: 'medium', timeStyle: 'short' }
		).format(date);
	}

	function moveSelection(offset: number) {
		if (visibleEmails.length === 0) return;
		const currentIndex = selectedEmail ? visibleEmails.findIndex((email) => email.id === selectedEmail.id) : -1;
		const nextIndex = currentIndex < 0
			? offset > 0 ? 0 : visibleEmails.length - 1
			: Math.max(0, Math.min(visibleEmails.length - 1, currentIndex + offset));
		updateMailboxUrl({ message: visibleEmails[nextIndex].id });
	}

	function isTypingTarget(target: EventTarget | null): boolean {
		if (!target || typeof target !== 'object' || !('tagName' in target)) return false;
		const element = target as HTMLElement;
		return element.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName);
	}

	function handleMessageFrameLoad(event: Event) {
		resizeHtmlMessage(event);
		(event.currentTarget as HTMLIFrameElement).contentDocument?.addEventListener('keydown', handleKeydown);
	}

	async function handleKeydown(event: KeyboardEvent) {
		if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
		if (showShortcuts && event.key !== 'Escape' && event.key !== '?') return;
		const key = event.key.toLowerCase();
		if (key === 'c') {
			event.preventDefault();
			openComposer({ mode: 'new', account: data.selectedAccount ?? undefined });
		} else if (key === 'r' && selectedEmail) {
			event.preventDefault();
			openComposer({ mode: 'reply', sourceEmailId: selectedEmail.id });
		} else if (key === 'a' && selectedEmail) {
			event.preventDefault();
			openComposer({ mode: 'replyAll', sourceEmailId: selectedEmail.id });
		} else if (key === 'f' && selectedEmail) {
			event.preventDefault();
			openComposer({ mode: 'forward', sourceEmailId: selectedEmail.id });
		} else if (key === 'j') {
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
			if (selectedEmail || visibleEmails[0]) {
				event.preventDefault();
				updateMailboxUrl({ message: (selectedEmail ?? visibleEmails[0]).id });
				await tick();
				readingContent?.focus({ preventScroll: true });
			}
		} else if (key === 'u' || event.key === 'Escape') {
			event.preventDefault();
			if (showShortcuts) showShortcuts = false;
			else updateMailboxUrl({ message: null });
		} else if (event.key === '?') {
			event.preventDefault();
			showShortcuts = !showShortcuts;
		}
	}

	const submitMessageAction: SubmitFunction = () => async ({ result, update }) => {
		await update();
		if (result.type === 'success') {
			updateMailboxUrl({ message: null });
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
		<div class="brand"><button class="menu-button" aria-label="Toggle mail categories" aria-expanded={showCategories} onclick={() => showCategories = !showCategories}>☰</button><h1>Inbox</h1></div>
		<form method="GET" class="search-form">
			{#if data.selectedAccount}<input type="hidden" name="account" value={data.selectedAccount} />{/if}
			<input name="q" aria-label="Search email" placeholder='Search email · "exact phrase" · from:example.com' value={data.query} />
			<button type="submit" aria-label="Search">⌕</button>
			{#if data.query}<a href={data.selectedAccount ? `/?account=${encodeURIComponent(data.selectedAccount)}` : '/'} aria-label="Clear search">×</a>{/if}
		</form>
		<button class="chat-button" onclick={() => openComposer({ mode: 'new', account: data.selectedAccount ?? undefined })}>Compose</button>
		<button class="drafts-button" onclick={() => window.dispatchEvent(new Event('email:drafts'))}>Drafts</button>
		<button class="chat-button" onclick={() => showChat = !showChat}>Chat with email</button>
		<nav class="app-links" aria-label="Application"><a href="/contacts">Contacts</a><a href="/calendar">Calendar</a><a href="/settings">Settings</a></nav>
		<button class="shortcuts-button" type="button" onclick={() => { showShortcuts = true; }}>Shortcuts <kbd>?</kbd></button>
		<form method="GET" class="account-picker">
			<label for="account">Account</label>
			{#if data.query}<input type="hidden" name="q" value={data.query} />{/if}
			<select id="account" name="account" onchange={(event) => event.currentTarget.form?.submit()}>
				<option value="">All accounts</option>
				{#each data.accounts as account}
					<option value={account.email} selected={data.selectedAccount === account.email}>{account.email}</option>
				{/each}
			</select>
		</form>
	</header>

	<div class="mailbox" class:show-detail={mobileDetail} class:show-categories={showCategories}>
		<nav class="sidebar" aria-label="Mail categories">
			<p class="eyebrow">MAILBOX</p>
			{#each filters as filter}
				<button class="filter" class:active={activeFilter === filter.category} aria-pressed={activeFilter === filter.category} onclick={() => selectFilter(filter.category)}>
					<span class="filter-label">{filter.label}</span><span class="count">{filter.count}</span>
				</button>
			{/each}
		</nav>

		<section class="list-pane" aria-label="Message list">
			<header class="pane-heading"><div class="mail-tabs"><button class:tab-active={activeFilter === 'all'} onclick={() => selectFilter('all')}>All mail <small>{data.emails.length}</small></button><button class:tab-active={activeFilter === 'important'} onclick={() => selectFilter('important')}>Important</button><button class:tab-active={activeFilter === 'useful'} onclick={() => selectFilter('useful')}>Useful</button></div><span>{filterLabel} · {visibleEmails.length}</span></header>
			{#if data.searchError}<p class="search-error" role="alert">{data.searchError}</p>{/if}
			{#if data.query}<p class="search-summary">Search results · Best match first · Includes archived mail</p>{/if}
			<div class="message-list">
				{#each visibleEmails as email (email.id)}
					<button class="message" class:unread={email.labels.includes('UNREAD')} class:selected={selectedEmail?.id === email.id} aria-pressed={selectedEmail?.id === email.id} onclick={() => updateMailboxUrl({ message: email.id })}>
						<span class="sender-avatar" aria-hidden="true">{senderName(email.fromAddress).slice(0, 1).toUpperCase()}</span>
						<strong class="sender" title={email.fromAddress}>{senderName(email.fromAddress)}</strong>
						<span class="message-line"><span class="subject">{email.subject || '(No subject)'}</span><span class="preview"> — {email.snippet || email.bodyText || 'No preview text.'}</span></span>
						<span class="category-tag">{email.category ? labels[email.category] : 'Pending'}</span>
						{#if importance(email) === 'important'}<span class="star" aria-label="Important">★</span>{:else}<span></span>{/if}
						<time title={email.accountEmail}>{formatDate(email.messageDate)}</time>
					</button>
				{:else}
					<div class="empty-state">
						<h3>{data.accounts.length === 0 ? 'No accounts yet' : data.emails.length === 0 ? 'No downloaded email' : 'No messages here'}</h3>
						<p>{data.accounts.length === 0 ? 'Connect an account to see your mail.' : data.emails.length === 0 ? 'Messages will appear after your account syncs.' : 'Try another search or category.'}</p>
					</div>
				{/each}
			</div>
		</section>

		<section class="detail-pane" aria-label="Message detail">
			<header class="pane-heading detail-toolbar">
				<button class="back-button" onclick={() => updateMailboxUrl({ message: null })}>← Back to messages</button>
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
						<details><summary>Classification details</summary><div class="classification-summary" aria-label="Jev classification results">
							{#if confidence(selectedEmail)}<span>Category confidence: <strong>{confidence(selectedEmail)}</strong></span>{/if}
							{#if jevAnswer(selectedEmail.hasActionItem, selectedEmail.actionItemProbability)}<span>Action item: <strong>{jevAnswer(selectedEmail.hasActionItem, selectedEmail.actionItemProbability)}</strong></span>{/if}
							{#if jevAnswer(selectedEmail.hasReminder, selectedEmail.reminderProbability)}<span>Reminder: <strong>{jevAnswer(selectedEmail.hasReminder, selectedEmail.reminderProbability)}</strong></span>{/if}
						</div>
						</details>
						{#if selectedEmail.classificationError}<p class="notice">Classification failed. This message needs another attempt.</p>{/if}
						{#if selectedEmail.actionItems.length > 0 || selectedEmail.reminders.length > 0 || selectedEmail.extractionError}
							<section class="extraction-panel" aria-label="Extracted action items and reminders">
								{#if selectedEmail.actionItems.length > 0}
									<div class="extraction-group">
										<h3>Action items</h3>
										<ul>
											{#each selectedEmail.actionItems as item}
												<li>
													<strong>{item.title}</strong>
													{#if item.details}<span>{item.details}</span>{/if}
													{#if extractedDate(item.dueAt)}<small>Due {extractedDate(item.dueAt)}</small>{/if}
												</li>
											{/each}
										</ul>
									</div>
								{/if}
								{#if selectedEmail.reminders.length > 0}
									<div class="extraction-group">
										<h3>Reminders</h3>
										<ul>
											{#each selectedEmail.reminders as reminder}
												<li>
													<strong>{reminder.title}</strong>
													{#if reminder.details}<span>{reminder.details}</span>{/if}
													{#if extractedDate(reminder.remindAt)}<small>Reminder {extractedDate(reminder.remindAt)}</small>{/if}
												</li>
											{/each}
										</ul>
									</div>
								{/if}
								{#if selectedEmail.extractionError}<p class="notice extraction-error">Extraction failed: {selectedEmail.extractionError}</p>{/if}
							</section>
						{/if}
						{#if form?.error}<p class="notice action-error" role="alert">{form.error}</p>{/if}
						<div class="message-actions">
							<button onclick={() => openComposer({ mode: 'reply', sourceEmailId: selectedEmail!.id })}>Reply</button>
							<button onclick={() => openComposer({ mode: 'replyAll', sourceEmailId: selectedEmail!.id })}>Reply all</button>
							<button onclick={() => openComposer({ mode: 'forward', sourceEmailId: selectedEmail!.id })}>Forward</button>
							<form bind:this={archiveForm} method="POST" action="?/archive" use:enhance={submitMessageAction}>
								<input type="hidden" name="id" value={selectedEmail.id} />
								<button type="submit">Archive</button>
							</form>
							<form bind:this={deleteForm} method="POST" action="?/delete" use:enhance={submitMessageAction} onsubmit={(event) => { if (!window.confirm('Move this message to Gmail Trash?')) event.preventDefault(); }}>
								<input type="hidden" name="id" value={selectedEmail.id} />
								<button type="submit" class="delete-button">Delete</button>
							</form>
							{#if selectedEmail.bodyHtml && hasRemoteImages(selectedEmail.bodyHtml) && remoteImagesFor !== selectedEmail.id}
								<button type="button" class="remote-images-button" onclick={() => { remoteImagesFor = selectedEmail.id; }}>Load remote images</button>
							{/if}
						</div>
						{#if selectedEmail.bodyHtml}
							<iframe class="html-message" title="Email message content" sandbox="allow-same-origin" referrerpolicy="no-referrer" srcdoc={buildEmailDocument(selectedEmail.bodyHtml, remoteImagesFor === selectedEmail.id)} onload={handleMessageFrameLoad}></iframe>
						{:else}
							<div class="message-body">{selectedEmail.bodyText || selectedEmail.snippet || 'No message text available.'}</div>
						{/if}
						{#if selectedEmail.bodyTruncated}<p class="notice">Only part of this message was downloaded.</p>{/if}
					</article>
				{/key}
			{:else}
				<div class="detail-empty"><span aria-hidden="true">@</span><h2>No message selected</h2><p>Choose a category and a message to read it here.</p></div>
			{/if}
		</section>
		<CalendarRail calendars={data.calendars} events={data.calendarEvents} day={data.calendarDay} />
	</div>
	{#if showChat}{#key data.selectedAccount}<EmailChat account={data.selectedAccount} close={() => showChat = false} />{/key}{/if}
	{#if showShortcuts}
		<div class="shortcut-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) showShortcuts = false; }}>
			<dialog open class="shortcut-dialog" aria-labelledby="shortcut-heading">
				<div class="shortcut-heading"><h2 id="shortcut-heading">Keyboard shortcuts</h2><button type="button" aria-label="Close keyboard shortcuts" onclick={() => { showShortcuts = false; }}>×</button></div>
				<dl>
					<div><dt><kbd>C</kbd></dt><dd>Compose a new message</dd></div>
					<div><dt><kbd>R</kbd></dt><dd>Reply to the selected message</dd></div>
					<div><dt><kbd>A</kbd></dt><dd>Reply all to the selected message</dd></div>
					<div><dt><kbd>F</kbd></dt><dd>Forward the selected message</dd></div>
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
	:global(html) { background: #0b0b0d; color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
	:global(body) { margin: 0; min-width: 320px; color: #dededf; }
	:global(button), :global(select) { font: inherit; }
	button { cursor: pointer; color: inherit; }
	button:focus-visible, select:focus-visible { outline: 2px solid #35b6ee; outline-offset: -3px; }
	h1, h2, h3, p { margin: 0; }
	main { height: 100dvh; display: flex; flex-direction: column; }
	.masthead { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 16px; border-bottom: 1px solid #2a2a2d; }
	.brand { display: flex; align-items: center; gap: 12px; }
	.menu-button { background: none; border: 0; font-size: 1.1rem; color: #999; }
	h1 { font-size: .95rem; letter-spacing: -.035em; white-space: nowrap; }
	.app-links { margin-left: auto; display: flex; gap: 16px; }
	.app-links a { color: #35b6ee; font-size: .85rem; text-decoration: none; }
	.account-picker { display: flex; align-items: center; gap: 12px; min-width: 0; }
	.account-picker label { color: #939398; font-size: .8rem; }
	.drafts-button { background: none; border: 0; color: #35b6ee; font-size: .8rem; }
	.shortcuts-button { border: 0; background: transparent; color: #35b6ee; font-size: .8rem; cursor: pointer; }
	kbd { display: inline-block; min-width: 1.5em; padding: 2px 5px; border: 1px solid #36363a; border-radius: 3px; background: #242427; color: #ceced2; font: .75rem ui-monospace, SFMono-Regular, Menlo, monospace; text-align: center; }
	select { min-width: 0; max-width: 100%; border: 1px solid #36363a; border-radius: 6px; padding: 8px 12px; background: #161618; color: #dededf; }
	.mailbox { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 210px; }
	.sidebar { display: none; padding: 24px 12px; overflow-y: auto; border-right: 1px solid #2a2a2d; }
	.eyebrow { padding: 0 12px 16px; color: #85858b; font-size: .7rem; font-weight: 700; letter-spacing: .14em; }
	.filter { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; text-align: left; border: 0; border-radius: 6px; padding: 12px; background: transparent; color: #aaaab0; font-size: .85rem; }
	.filter:nth-of-type(3) { margin-bottom: 20px; }
	.filter:hover { background: #242427; }
	.filter.active { background: #173e50; color: #79cbed; font-weight: 650; }
	.filter-label { overflow-wrap: anywhere; }
	.count { font-size: .75rem; font-variant-numeric: tabular-nums; }
	.list-pane, .detail-pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
	.list-pane { border-right: 1px solid #2a2a2d; background: #161618; }
	.pane-heading { min-height: 48px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid #2a2a2d; }
	.pane-heading > span { color: #99999e; font-size: .75rem; }
	.message-list { overflow-y: auto; flex: 1; }
	.message { display: grid; grid-template-columns: 24px minmax(110px, 19%) minmax(0, 1fr) auto 14px 66px; align-items: center; gap: 9px; width: 100%; height: 36px; padding: 0 16px; text-align: left; border: 0; border-left: 2px solid transparent; background: transparent; color: #99999e; font-size: .75rem; }
	.message:hover { background: #222225; }
	.message.selected { background: #173e50; border-left-color: #35b6ee; }
	.sender-avatar { display: grid; place-items: center; width: 21px; height: 21px; border-radius: 5px; background: #354555; color: #cfdeee; font-size: .7rem; }
	.sender, .subject { font-weight: 400; }
	.sender, .message-line { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.unread .sender, .unread .subject, .unread time { color: #ddd; font-weight: 650; }
	.preview { color: #707075; }
	.category-tag { padding: 2px 5px; border-radius: 3px; background: #242426; color: #96969a; font-size: .6rem; }
	.star { color: #dcad32; }
	time { text-align: right; font-size: .62rem; }
	.mail-tabs { display: flex; gap: 6px; }
	.mail-tabs button { border: 0; border-radius: 5px; padding: 5px 8px; color: #888; background: none; font-size: .8rem; }
	.mail-tabs .tab-active { color: #ddd; background: #2c2c2e; }
	.mail-tabs small { color: #888; }
	.mailbox.show-detail { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 210px; }
	.mailbox.show-categories { grid-template-columns: 180px minmax(0, 1fr) 210px; }
	.mailbox.show-categories.show-detail { grid-template-columns: 180px minmax(0, 1fr) minmax(0, 1fr) 210px; }
	.show-categories .sidebar { display: block; }
	.show-detail .detail-pane { display: flex; }
	.show-detail .category-tag { display: none; }
	.show-detail .message { grid-template-columns: 22px minmax(85px, 23%) minmax(0, 1fr) 14px 56px; padding-inline: 10px; }
	details { margin-top: 12px; font-size: .7rem; color: #888; }

	.useful-tag { display: inline-block; border-radius: 4px; padding: 3px 6px; font-size: .65rem; font-weight: 700; }
	.useful-tag { background: #ffde5920; color: #ffde59; }
	.detail-pane { display: none; border-right: 1px solid #2a2a2d; background: #161618; }
	.reading-content { padding: 24px; overflow-y: auto; overflow-wrap: anywhere; }
	.reading-content h2 { font-size: 1.05rem; line-height: 1.35; letter-spacing: -.025em; }
	.message-metadata { margin: 24px 0 12px; font-size: .8rem; line-height: 1.6; }
	.message-metadata > div { display: grid; grid-template-columns: 64px minmax(0, 1fr); margin-top: 4px; }
	dt { color: #85858b; } dd { margin: 0; color: #b6b6bb; }
	.classification-summary { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 16px; color: #85858b; font-size: .75rem; }
	.classification-summary strong { color: #ceced2; font-weight: 600; }
	.extraction-panel { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 24px; padding: 16px; border: 1px solid #2a2a2d; border-radius: 6px; background: #161618; }
	.extraction-group { min-width: 0; }
	.extraction-group h3 { color: #79cbed; font-size: .78rem; letter-spacing: .02em; }
	.extraction-group ul { display: grid; gap: 12px; margin: 12px 0 0; padding: 0; list-style: none; }
	.extraction-group li { display: grid; gap: 4px; padding-top: 12px; border-top: 1px solid #2a2a2d; font-size: .82rem; line-height: 1.45; }
	.extraction-group li:first-child { padding-top: 0; border-top: 0; }
	.extraction-group li strong { color: #dededf; font-weight: 650; }
	.extraction-group li span { color: #b6b6bb; }
	.extraction-group li small { color: #939398; font-size: .72rem; }
	.message-body { margin-top: 28px; padding-top: 28px; border-top: 1px solid #2a2a2d; white-space: pre-wrap; line-height: 1.75; font-size: .92rem; color: #ceced2; }
	.html-message { display: block; width: 100%; height: 60dvh; margin-top: 28px; border: 0; background: white; color-scheme: light; }
	.notice { margin-top: 20px; color: #ffde59; font-size: .8rem; }
	.action-error { color: #ff9fb2; }
	.extraction-error { grid-column: 1 / -1; margin-top: 0; }
	.message-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
	.message-actions button { border: 1px solid #35b6ee; border-radius: 4px; padding: 8px 14px; background: #35b6ee; color: #0b0b0d; font-size: .8rem; font-weight: 650; }
	.message-actions .delete-button { border-color: #a84c63; background: transparent; color: #ff9fb2; }
	.message-actions .remote-images-button { border-color: #36363a; background: transparent; color: #79cbed; }
	.shortcut-backdrop { position: fixed; inset: 0; z-index: 10; display: grid; place-items: center; padding: 20px; background: #0009; }
	.shortcut-dialog { width: min(420px, 100%); padding: 24px; border: 1px solid #36363a; border-radius: 8px; background: #161618; box-shadow: 0 20px 60px #0008; }
	.shortcut-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
	.shortcut-heading h2 { font-size: 1.1rem; }
	.shortcut-heading button { border: 0; background: transparent; color: #939398; font-size: 1.5rem; cursor: pointer; }
	.shortcut-dialog dl { margin: 20px 0 0; }
	.shortcut-dialog dl > div { display: grid; grid-template-columns: 90px 1fr; align-items: center; gap: 12px; padding: 8px 0; border-top: 1px solid #2a2a2d; }
	.shortcut-dialog dt { display: flex; gap: 4px; }
	.shortcut-dialog dd { margin: 0; color: #ceced2; font-size: .85rem; }
	.empty-state { padding: 32px 20px; } .empty-state h3 { font-size: 1rem; }
	.empty-state p, .detail-empty p { margin-top: 10px; color: #939398; font-size: .85rem; line-height: 1.6; }
	.detail-empty { margin: auto; padding: 32px; text-align: center; }
	.detail-empty > span { display: block; margin-bottom: 20px; font-size: 3rem; color: #36363a; }
	.detail-empty h2 { font-size: 1.2rem; }
	.back-button { display: block; background: transparent; border: 0; padding: 8px 0; color: #35b6ee; font-size: .8rem; }
	.chat-button { background: #143444; color: #51c1ee; border: 0; border-radius: 5px; padding: 8px; font-size: .75rem; white-space: nowrap; }
	.search-form { display: flex; align-items: center; flex: 1; max-width: 560px; margin-left: auto; border: 1px solid #303034; border-radius: 6px; }
	.search-form input { width: 100%; min-width: 0; padding: 8px 10px; background: transparent; border: 0; color: #ddd; font: inherit; font-size: .75rem; }
	.search-form button { border: 0; background: none; padding: 4px 10px; font-size: 1.2rem; color: #aaa; }
	.search-form a { padding: 0 10px; color: #aaa; text-decoration: none; }
	.search-summary, .search-error { padding: 8px 16px; font-size: .7rem; color: #999; border-bottom: 1px solid #28282b; }
	.search-error { color: #ff9fb2; }
	@media (max-width: 760px) { .search-form { order: 5; flex-basis: 100%; max-width: none; } }
	@media (max-width: 1100px) {
		.mailbox > :global(aside) { display: none; }
		.mailbox { grid-template-columns: minmax(0, 1fr); }
		.mailbox.show-detail { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
		.mailbox.show-categories { grid-template-columns: 160px minmax(0, 1fr); }
		.mailbox.show-categories.show-detail { grid-template-columns: 160px minmax(0, 1fr) minmax(0, 1fr); }
	}
	@media (max-width: 760px) {
		.masthead { flex-wrap: wrap; gap: 10px; }
		.account-picker { margin-left: auto; }
		.account-picker label, .shortcuts-button { display: none; }
		.mailbox, .mailbox.show-detail, .mailbox.show-categories, .mailbox.show-categories.show-detail { grid-template-columns: minmax(0, 1fr); }
		.show-categories .sidebar { display: flex; overflow-x: auto; padding: 6px; }
		.show-categories { grid-template-rows: auto minmax(0, 1fr); }
		.eyebrow { display: none; }
		.filter { width: auto; flex-shrink: 0; gap: 8px; }
		.filter:nth-of-type(3) { margin-bottom: 0; }
		.show-detail .list-pane { display: none; }
		.message { grid-template-columns: 22px 90px minmax(0, 1fr) 52px; padding-inline: 8px; height: 44px; }
		.message > .category-tag, .message > .star, .message > span:empty { display: none; }
		.pane-heading > span { display: none; }
		.detail-toolbar { flex-wrap: wrap; }
		.extraction-panel { grid-template-columns: minmax(0, 1fr); }
	}
</style>
