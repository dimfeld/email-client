<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	let query = $state('');
	let visibleContacts = $derived(data.contacts.filter((contact) => {
		const needle = query.trim().toLowerCase();
		return !needle || [contact.displayName, contact.organization, ...contact.emails, ...contact.phones]
			.some((value) => value?.toLowerCase().includes(needle));
	}));
</script>

<svelte:head><title>Contacts — Email Check</title></svelte:head>

<main>
	<header class="masthead">
		<a class="brand" href="/"><span aria-hidden="true">@</span><strong>Email Check</strong></a>
		<nav aria-label="Application"><a href="/">Mail</a><a class="active" href="/contacts">Contacts</a><a href="/calendar">Calendar</a><a href="/settings">Settings</a></nav>
	</header>
	<section class="content">
		<div class="heading"><div><p class="eyebrow">ADDRESS BOOK</p><h1>Contacts</h1><p>{visibleContacts.length} synced contact{visibleContacts.length === 1 ? '' : 's'}</p></div>
			<form method="GET"><label for="account">Account</label><select id="account" name="account" onchange={(event) => event.currentTarget.form?.submit()}><option value="">All accounts</option>{#each data.accounts as account}<option value={account.email} selected={data.selectedAccount === account.email}>{account.email}</option>{/each}</select></form>
		</div>
		<label class="search" for="contact-search">Search contacts</label><input id="contact-search" type="search" bind:value={query} placeholder="Name, email, phone, or organization" />
		<div class="grid">
			{#each visibleContacts as contact (contact.accountEmail + contact.resourceName)}
				<article><div class="avatar" aria-hidden="true">{contact.displayName.slice(0, 1).toUpperCase() || '?'}</div><div><h2>{contact.displayName || 'Unnamed contact'}</h2>{#if contact.organization}<p>{contact.organization}</p>{/if}{#each contact.emails as email}<a href={`mailto:${email}`}>{email}</a>{/each}{#each contact.phones as phone}<a href={`tel:${phone}`}>{phone}</a>{/each}<small>{contact.accountEmail}</small></div></article>
			{:else}<div class="empty"><h2>No synced contacts</h2><p>Run <code>bun run sync:google</code> to download the address book.</p></div>{/each}
		</div>
	</section>
</main>

<style>
	:global(*) { box-sizing: border-box; } :global(html) { background:#07131c; color-scheme:dark; font-family:Inter,ui-sans-serif,system-ui,sans-serif; } :global(body) { margin:0; color:#edf7fb; }
	a { color:#6edff3; } .masthead { display:flex; align-items:center; gap:24px; padding:16px 24px; border-bottom:1px solid #23404e; } .brand { display:flex; gap:10px; color:#edf7fb; text-decoration:none; } .brand span { color:#6edff3; font-size:1.4rem; } nav { margin-left:auto; display:flex; gap:18px; } nav a { color:#91adb9; text-decoration:none; font-size:.85rem; } nav a.active { color:#6edff3; }
	.content { width:min(1100px,100%); margin:0 auto; padding:40px 24px; } .heading { display:flex; justify-content:space-between; align-items:end; gap:24px; } h1,h2,p { margin:0; } h1 { font-size:2rem; } .heading p:not(.eyebrow) { margin-top:8px; color:#8eabb8; } .eyebrow { color:#6edff3; font-size:.7rem; letter-spacing:.14em; font-weight:700; margin-bottom:8px; } form { display:flex; align-items:center; gap:10px; } label { color:#91adb9; font-size:.8rem; } select,input { font:inherit; border:1px solid #365869; border-radius:6px; background:#0d202b; color:#edf7fb; padding:10px 12px; } .search { display:block; margin-top:32px; margin-bottom:8px; } input { width:100%; }
	.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(290px,1fr)); gap:14px; margin-top:20px; } article { display:grid; grid-template-columns:44px 1fr; gap:14px; padding:18px; border:1px solid #23404e; border-radius:8px; background:#0b1c26; overflow:hidden; } .avatar { display:grid; place-items:center; width:44px; height:44px; border-radius:50%; background:#193a49; color:#a3effb; font-weight:700; } article h2 { font-size:1rem; } article p, article a, article small { display:block; margin-top:7px; overflow-wrap:anywhere; font-size:.78rem; } article p, article small { color:#8eabb8; } article small { margin-top:12px; } .empty { grid-column:1/-1; padding:48px 24px; border:1px dashed #365869; text-align:center; } .empty p { margin-top:10px; color:#8eabb8; }
	@media (max-width:700px) { .masthead { flex-wrap:wrap; } nav { width:100%; margin:0; overflow-x:auto; } .content { padding:28px 16px; } .heading { align-items:start; flex-direction:column; } }
</style>
