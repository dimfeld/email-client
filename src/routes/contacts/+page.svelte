<script lang="ts">
	import { openComposer } from '$lib/composer';
	import type { SyncedContact } from '$lib/server/types';
	import { contactInitials, contactIsUnnamed, contactKey, contactLabel, contactMatches, groupContacts } from '$lib/contacts';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let query = $state('');
	let selectedKey = $state<string | null>(null);
	let detailOpen = $state(false);

	let visibleContacts = $derived(data.contacts.filter((contact) => contactMatches(contact, query)));
	let groups = $derived(groupContacts(visibleContacts));
	let selectedAccount = $derived(data.accounts.find((account) => account.email === data.selectedAccount));
	let selected = $derived<SyncedContact | null>(
		visibleContacts.find((contact) => contactKey(contact) === selectedKey) ?? groups[0]?.contacts[0] ?? null);

	function select(contact: SyncedContact) {
		selectedKey = contactKey(contact);
		detailOpen = true;
	}
</script>

<svelte:head><title>Contacts — Email Check</title></svelte:head>

<main>
	<header class="masthead">
		<a class="brand" href="/"><span aria-hidden="true">@</span><strong>Email Check</strong></a>
		<nav aria-label="Application"><a href="/">Mail</a><a class="active" href="/contacts">Contacts</a><a href="/calendar">Calendar</a><a href="/settings">Settings</a></nav>
	</header>
	<section class="book" class:detail-open={detailOpen}>
		<div class="list-pane">
			<div class="list-tools">
				<input type="search" bind:value={query} placeholder="Search" aria-label="Search contacts" />
				<form method="GET">
					<select name="account" aria-label="Account" onchange={(event) => event.currentTarget.form?.submit()}>
						<option value="">All accounts</option>
						{#each data.accounts as account (account.email)}<option value={account.email} selected={data.selectedAccount === account.email}>{account.email}</option>{/each}
					</select>
				</form>
			</div>
			<p class="count">{visibleContacts.length} contact{visibleContacts.length === 1 ? '' : 's'}</p>
			<div class="list" role="listbox" aria-label="Contacts">
				{#each groups as group (group.letter)}
					<div class="letter" aria-hidden="true">{group.letter}</div>
					{#each group.contacts as contact (contactKey(contact))}
						{@const active = selected !== null && contactKey(contact) === contactKey(selected)}
						<button type="button" class="row" class:active role="option" aria-selected={active} onclick={() => select(contact)}>
							<span class="avatar small" aria-hidden="true">{contactInitials(contact)}</span>
							<span class="row-text">
								<span class="name" class:muted={contactIsUnnamed(contact)}>{contactLabel(contact)}</span>
								{#if contact.displayName && contact.organization}<span class="sub">{contact.organization}</span>
								{:else if contact.emails[0] && contactLabel(contact) !== contact.emails[0]}<span class="sub">{contact.emails[0]}</span>{/if}
							</span>
						</button>
					{/each}
				{:else}
					<div class="empty">
						{#if data.contacts.length === 0}
							{#if selectedAccount?.contactsSyncedAt}
								<h2>No contacts found</h2><p>No contacts are saved for {selectedAccount.email}. The last sync completed {new Date(selectedAccount.contactsSyncedAt).toLocaleString()}. Check this account's Google Contacts, then select <strong>Sync now</strong> in Settings.</p>
							{:else}<h2>No synced contacts</h2><p>Run <code>bun run sync:google</code> to download the address book.</p>{/if}
						{:else}<h2>No matches</h2><p>No contact matches “{query.trim()}”.</p>{/if}
					</div>
				{/each}
			</div>
		</div>

		<div class="detail-pane">
			{#if selected}
				<article class="detail">
					<button type="button" class="back" onclick={() => (detailOpen = false)}>‹ Contacts</button>
					<div class="identity">
						<div class="avatar large" aria-hidden="true">{contactInitials(selected)}</div>
						<h1 class:muted={contactIsUnnamed(selected)}>{contactLabel(selected)}</h1>
						{#if selected.displayName && selected.organization}<p class="org">{selected.organization}</p>{/if}
					</div>
					{#if selected.emails.length}
						<section class="fields">
							<h2>Email</h2>
							{#each selected.emails as email (email)}<div class="field"><a href={`mailto:${email}`} onclick={(event) => { event.preventDefault(); openComposer({ mode: 'new', account: selected!.accountEmail, to: email }); }}>{email}</a></div>{/each}
						</section>
					{/if}
					{#if selected.phones.length}
						<section class="fields">
							<h2>Phone</h2>
							{#each selected.phones as phone (phone)}<div class="field"><a href={`tel:${phone}`}>{phone}</a></div>{/each}
						</section>
					{/if}
					{#if !selected.emails.length && !selected.phones.length}
						<p class="none">No email address or phone number.</p>
					{/if}
					<section class="fields">
						<h2>Account</h2>
						<div class="field">{selected.accountEmail}</div>
					</section>
				</article>
			{:else}
				<div class="placeholder"><p>{data.contacts.length === 0 ? 'Sync an account to see contacts here.' : 'Select a contact to see details.'}</p></div>
			{/if}
		</div>
	</section>
</main>

<style>
	:global(*) { box-sizing:border-box; } :global(html) { background:#07131c; color-scheme:dark; font-family:Inter,ui-sans-serif,system-ui,sans-serif; } :global(body) { margin:0; color:#edf7fb; }
	a { color:#6edff3; } h1,h2,p { margin:0; }
	.masthead { display:flex; align-items:center; gap:24px; padding:16px 24px; border-bottom:1px solid #23404e; } .brand { display:flex; gap:10px; color:#edf7fb; text-decoration:none; } .brand span { color:#6edff3; font-size:1.4rem; } nav { margin-left:auto; display:flex; gap:18px; } nav a { color:#91adb9; text-decoration:none; font-size:.85rem; } nav a.active { color:#6edff3; }

	.book { display:grid; grid-template-columns:340px minmax(0,1fr); height:calc(100vh - 61px); }
	.list-pane { display:flex; flex-direction:column; min-height:0; min-width:0; border-right:1px solid #23404e; background:#0b1c26; }
	.list-tools { display:flex; flex-direction:column; gap:8px; padding:14px 14px 6px; }
	input, select { width:100%; font:inherit; font-size:.9rem; border:1px solid #365869; border-radius:6px; background:#0d202b; color:#edf7fb; padding:8px 10px; }
	select { font-size:.8rem; color:#c9dde5; }
	.count { padding:2px 14px 8px; color:#7595a3; font-size:.72rem; }
	.list { flex:1; min-height:0; overflow-y:auto; }
	.letter { position:sticky; top:0; z-index:1; padding:4px 14px; background:#0b1c26; color:#6edff3; font-size:.7rem; font-weight:700; letter-spacing:.1em; border-top:1px solid #1a3240; border-bottom:1px solid #1a3240; }
	.row { display:flex; align-items:center; gap:12px; width:100%; min-width:0; padding:8px 14px; border:0; background:transparent; color:#edf7fb; font:inherit; text-align:left; cursor:pointer; }
	.row:hover { background:#102532; } .row.active { background:#193a49; }
	.row-text { display:flex; flex-direction:column; min-width:0; } .name { font-size:.92rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } .sub { color:#8eabb8; font-size:.74rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
	.muted { color:#a9bfc9; font-style:italic; }
	.avatar { display:grid; place-items:center; flex:none; border-radius:50%; background:#193a49; color:#a3effb; font-weight:700; } .avatar.small { width:36px; height:36px; font-size:.78rem; } .avatar.large { width:96px; height:96px; font-size:2rem; }
	.empty { margin:16px 14px; padding:32px 16px; border:1px dashed #365869; border-radius:8px; text-align:center; } .empty h2 { font-size:1rem; } .empty p { margin-top:10px; color:#8eabb8; font-size:.8rem; overflow-wrap:anywhere; }

	.detail-pane { min-height:0; min-width:0; overflow-y:auto; }
	.detail { width:min(640px,100%); margin:0 auto; padding:40px 32px; }
	.back { display:none; font:inherit; font-size:.85rem; margin-bottom:20px; padding:0; border:0; background:transparent; color:#6edff3; cursor:pointer; }
	.identity { display:flex; flex-direction:column; align-items:center; text-align:center; gap:12px; padding-bottom:28px; border-bottom:1px solid #23404e; }
	.identity h1 { font-size:1.6rem; overflow-wrap:anywhere; } .org { color:#8eabb8; font-size:.95rem; }
	.fields { padding:18px 0; border-bottom:1px solid #23404e; } .fields h2 { color:#7595a3; font-size:.7rem; font-weight:700; letter-spacing:.12em; text-transform:uppercase; margin-bottom:8px; }
	.field { padding:5px 0; font-size:.95rem; overflow-wrap:anywhere; }
	.field a { text-decoration:none; } .field a:hover { text-decoration:underline; }
	.none { padding:18px 0; color:#8eabb8; font-size:.9rem; border-bottom:1px solid #23404e; }
	.placeholder { display:grid; place-items:center; height:100%; color:#7595a3; font-size:.95rem; }

	@media (max-width:760px) {
		.masthead { flex-wrap:wrap; } nav { width:100%; margin:0; overflow-x:auto; }
		.book { grid-template-columns:1fr; height:auto; min-height:calc(100vh - 61px); }
		.list-pane { border-right:0; } .list { overflow:visible; } .letter { top:0; }
		.detail-pane, .detail-open .list-pane { display:none; } .detail-open .detail-pane { display:block; }
		.back { display:inline-block; } .detail { padding:20px 16px; }
	}
</style>
