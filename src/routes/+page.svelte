<script lang="ts">
	import type { PageData } from './$types';
	import type { StoredEmail } from '$lib/server/types';

	let { data }: { data: PageData } = $props();

	const categoryOrder = [
		'action',
		'personal',
		'work',
		'transaction',
		'newsletter',
		'notification',
		'marketing',
		'other',
		'pending'
	] as const;

	const labels: Record<(typeof categoryOrder)[number], string> = {
		action: 'Action needed',
		personal: 'Personal',
		work: 'Work',
		transaction: 'Transactions',
		newsletter: 'Newsletters',
		notification: 'Notifications',
		marketing: 'Marketing',
		other: 'Other',
		pending: 'Needs classification'
	};

	let useful = $derived(data.emails.filter((email) => email.useful));
	let grouped = $derived(
		categoryOrder
			.map((category) => ({
				category,
				emails: data.emails.filter((email) => (email.category ?? 'pending') === category)
			}))
			.filter((group) => group.emails.length > 0)
	);

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
</script>

<svelte:head>
	<title>Email Check — {data.selectedAccount ?? 'All accounts'}</title>
</svelte:head>

<main>
	<header class="masthead">
		<div>
			<p class="eyebrow">LOCAL MAIL TRIAGE</p>
			<h1>Email Check</h1>
		</div>
		<form method="GET" class="account-picker">
			<label for="account">Account</label>
			<select
				id="account"
				name="account"
				onchange={(event) => event.currentTarget.form?.submit()}
			>
				<option value="">All accounts</option>
				{#each data.accounts as account}
					<option value={account.email} selected={data.selectedAccount === account.email}>
						{account.email}
					</option>
				{/each}
			</select>
		</form>
	</header>

	{#if data.accounts.length === 0}
		<section class="empty-state">
			<span class="empty-mark">@</span>
			<div>
				<h2>No accounts yet</h2>
				<p>Run <code>bun run accounts:discover</code>, then configure a Pub/Sub subscription.</p>
			</div>
		</section>
	{:else if data.emails.length === 0}
		<section class="empty-state">
			<span class="empty-mark">0</span>
			<div>
				<h2>No downloaded email</h2>
				<p>Run an initial sync or start the app with a configured Pub/Sub subscription.</p>
			</div>
		</section>
	{:else}
		<section class="raised">
			<div class="section-heading">
				<div>
					<p class="eyebrow">RAISED BY JEV</p>
					<h2>Useful now</h2>
				</div>
				<span class="count">{useful.length}</span>
			</div>
			{#if useful.length > 0}
				<div class="email-grid">
					{#each useful as email}
						<article class="email-card raised-card">
							<div class="card-topline">
								<span class="category">{labels[email.category ?? 'pending']}</span>
								<span>{formatDate(email.messageDate)}</span>
							</div>
							<h3>{email.subject}</h3>
							<p class="sender">{senderName(email.fromAddress)}</p>
							<p class="snippet">{email.snippet || email.body || 'No preview text.'}</p>
							<footer>
								<span>{email.accountEmail}</span>
								{#if confidence(email)}<span>Jev {confidence(email)}</span>{/if}
							</footer>
						</article>
					{/each}
				</div>
			{:else}
				<p class="quiet">Jev has not raised any downloaded messages.</p>
			{/if}
		</section>

		<section class="categories">
			<div class="section-heading">
				<div>
					<p class="eyebrow">ALL DOWNLOADED MAIL</p>
					<h2>By category</h2>
				</div>
				<span class="count muted">{data.emails.length}</span>
			</div>

			{#each grouped as group}
				<section class="category-group">
					<header>
						<h3>{labels[group.category]}</h3>
						<span>{group.emails.length}</span>
					</header>
					<div class="email-list">
						{#each group.emails as email}
							<article class:useful={email.useful} class="email-row">
								<div class="row-main">
									<div class="row-title">
										<strong>{email.subject}</strong>
										{#if email.useful}<span class="useful-tag">Useful</span>{/if}
										{#if email.classificationError}<span class="error-tag">Retry needed</span>{/if}
									</div>
									<p>{senderName(email.fromAddress)} · {email.snippet || email.body || 'No preview text.'}</p>
								</div>
								<div class="row-meta">
									<span>{formatDate(email.messageDate)}</span>
									<span>{email.accountEmail}</span>
								</div>
							</article>
						{/each}
					</div>
				</section>
			{/each}
		</section>
	{/if}
</main>

<style>
	:global(*) { box-sizing: border-box; }
	:global(html) { background: #07131c; color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
	:global(body) { margin: 0; min-width: 320px; background: #07131c; color: #edf7fb; }
	:global(button), :global(select) { font: inherit; }
	main { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 42px 0 80px; }
	.masthead { display: flex; align-items: end; justify-content: space-between; gap: 24px; padding-bottom: 30px; border-bottom: 1px solid #23404e; }
	h1, h2, h3, p { margin: 0; }
	h1 { margin-top: 5px; font: 700 clamp(2.5rem, 7vw, 5.6rem)/0.9 Georgia, serif; letter-spacing: -0.055em; color: #f7fbf4; }
	h2 { font: 650 clamp(1.7rem, 4vw, 3rem)/1 Georgia, serif; letter-spacing: -0.035em; }
	.eyebrow { color: #6edff3; font-size: 0.76rem; font-weight: 800; letter-spacing: 0.18em; }
	.account-picker { display: grid; gap: 7px; min-width: min(100%, 280px); }
	.account-picker label { color: #8eabb8; font-size: 0.82rem; font-weight: 700; }
	select { width: 100%; border: 1px solid #365869; border-radius: 4px; padding: 10px 34px 10px 12px; background: #0d202b; color: #edf7fb; }
	.raised, .categories { padding-top: 44px; }
	.section-heading { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin-bottom: 20px; }
	.section-heading h2 { margin-top: 6px; }
	.count { display: grid; place-items: center; min-width: 46px; height: 46px; border-radius: 50%; background: #ffde59; color: #15232a; font-weight: 900; }
	.count.muted { background: #193341; color: #9db9c5; }
	.email-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 14px; }
	.email-card { min-height: 240px; padding: 20px; border: 1px solid #315364; border-radius: 7px; background: #0c202b; box-shadow: 0 18px 60px rgba(0,0,0,.22); }
	.raised-card { border-top: 4px solid #ffde59; }
	.card-topline, .email-card footer { display: flex; justify-content: space-between; gap: 16px; color: #88a9b7; font-size: .78rem; }
	.category { color: #ffde59; font-weight: 850; text-transform: uppercase; letter-spacing: .08em; }
	.email-card h3 { margin-top: 23px; font-size: 1.25rem; line-height: 1.2; }
	.sender { margin-top: 8px; color: #6edff3; font-size: .9rem; font-weight: 700; }
	.snippet { display: -webkit-box; overflow: hidden; margin-top: 18px; color: #bfd1d8; line-height: 1.55; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; }
	.email-card footer { margin-top: 24px; padding-top: 15px; border-top: 1px solid #213e4b; }
	.quiet { padding: 28px; border: 1px dashed #315364; color: #8eabb8; }
	.category-group { margin-top: 30px; }
	.category-group > header { display: flex; align-items: center; justify-content: space-between; padding: 0 2px 10px; border-bottom: 2px solid #315364; }
	.category-group > header h3 { font-size: 1.05rem; }
	.category-group > header span { color: #8eabb8; }
	.email-list { display: grid; }
	.email-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; padding: 17px 2px; border-bottom: 1px solid #193541; }
	.email-row.useful { background: linear-gradient(90deg, rgba(255,222,89,.075), transparent 65%); }
	.row-title { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; }
	.row-main strong { font-size: 1rem; color: #eff8fa; }
	.row-main p { overflow: hidden; margin-top: 7px; color: #8eabb8; font-size: .88rem; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
	.row-meta { display: grid; justify-items: end; gap: 6px; color: #7595a3; font-size: .78rem; }
	.useful-tag, .error-tag { border-radius: 999px; padding: 3px 7px; font-size: .7rem; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; }
	.useful-tag { background: #ffde59; color: #17252b; }
	.error-tag { background: #ff708d; color: #1e1115; }
	.empty-state { display: flex; align-items: center; gap: 24px; margin-top: 56px; padding: 32px; border: 1px dashed #365869; background: #0a1b25; }
	.empty-state h2 { font-size: 1.8rem; }
	.empty-state p { margin-top: 9px; color: #9bb4bf; line-height: 1.5; }
	.empty-state code { color: #ffde59; }
	.empty-mark { font: 700 3rem/1 Georgia, serif; color: #6edff3; }
	@media (max-width: 680px) {
		main { width: min(100% - 22px, 1180px); padding-top: 24px; }
		.masthead { align-items: stretch; flex-direction: column; }
		.account-picker { min-width: 100%; }
		.email-row { grid-template-columns: 1fr; gap: 10px; }
		.row-meta { display: flex; justify-content: space-between; }
		.email-card footer { align-items: flex-start; flex-direction: column; }
	}
</style>
