<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	let calendarNames = $derived(new Map(data.calendars.map((calendar) => [`${calendar.accountEmail}\0${calendar.calendarId}`, calendar.summary])));
	function calendarName(account: string, id: string) { return calendarNames.get(`${account}\0${id}`) ?? id; }
	function dateLabel(value: string, allDay: boolean) {
		const date = new Date(allDay ? `${value}T00:00:00` : value);
		if (Number.isNaN(date.valueOf())) return value;
		return new Intl.DateTimeFormat(undefined, allDay
			? { weekday:'short', month:'short', day:'numeric', year:'numeric' }
			: { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }).format(date);
	}
</script>

<svelte:head><title>Calendar — Email Check</title></svelte:head>

<main>
	<header class="masthead"><a class="brand" href="/"><span aria-hidden="true">@</span><strong>Email Check</strong></a><nav aria-label="Application"><a href="/">Mail</a><a href="/contacts">Contacts</a><a class="active" href="/calendar">Calendar</a><a href="/settings">Settings</a></nav></header>
	<section class="content">
		<div class="heading"><div><p class="eyebrow">SCHEDULE</p><h1>Calendar</h1><p>{data.events.length} synced event{data.events.length === 1 ? '' : 's'} from {data.calendars.length} calendar{data.calendars.length === 1 ? '' : 's'}</p></div><form method="GET"><label for="account">Account</label><select id="account" name="account" onchange={(event) => event.currentTarget.form?.submit()}><option value="">All accounts</option>{#each data.accounts as account}<option value={account.email} selected={data.selectedAccount === account.email}>{account.email}</option>{/each}</select></form></div>
		<div class="events">
			{#each data.events as event (event.accountEmail + event.calendarId + event.eventId)}
				<article><div class="date"><strong>{dateLabel(event.startAt,event.allDay)}</strong>{#if !event.allDay}<span>to {dateLabel(event.endAt,false)}</span>{/if}</div><div><div class="meta"><span>{calendarName(event.accountEmail,event.calendarId)}</span><small>{event.accountEmail}</small></div><h2>{event.summary}</h2>{#if event.location}<p>{event.location}</p>{/if}{#if event.organizer}<p>Organizer: {event.organizer}</p>{/if}{#if event.htmlLink}<a href={event.htmlLink} target="_blank" rel="noreferrer">Open in Google Calendar</a>{/if}</div></article>
			{:else}<div class="empty"><h2>No synced events</h2><p>Run <code>bun run sync:google</code> to download calendars and events.</p></div>{/each}
		</div>
	</section>
</main>

<style>
	:global(*) { box-sizing:border-box; } :global(html) { background:#07131c; color-scheme:dark; font-family:Inter,ui-sans-serif,system-ui,sans-serif; } :global(body) { margin:0; color:#edf7fb; } a { color:#6edff3; }
	.masthead { display:flex; align-items:center; gap:24px; padding:16px 24px; border-bottom:1px solid #23404e; } .brand { display:flex; gap:10px; color:#edf7fb; text-decoration:none; } .brand span { color:#6edff3; font-size:1.4rem; } nav { margin-left:auto; display:flex; gap:18px; } nav a { color:#91adb9; text-decoration:none; font-size:.85rem; } nav a.active { color:#6edff3; }
	.content { width:min(1050px,100%); margin:0 auto; padding:40px 24px; } .heading { display:flex; justify-content:space-between; align-items:end; gap:24px; } h1,h2,p { margin:0; } h1 { font-size:2rem; } .heading p:not(.eyebrow) { margin-top:8px; color:#8eabb8; } .eyebrow { color:#6edff3; font-size:.7rem; letter-spacing:.14em; font-weight:700; margin-bottom:8px; } form { display:flex; align-items:center; gap:10px; } label { color:#91adb9; font-size:.8rem; } select { font:inherit; border:1px solid #365869; border-radius:6px; background:#0d202b; color:#edf7fb; padding:10px 12px; }
	.events { margin-top:32px; border-top:1px solid #23404e; } article { display:grid; grid-template-columns:230px minmax(0,1fr); gap:28px; padding:24px 8px; border-bottom:1px solid #23404e; } .date strong,.date span { display:block; } .date strong { color:#a3effb; font-size:.85rem; } .date span { margin-top:7px; color:#7595a3; font-size:.75rem; } .meta { display:flex; align-items:center; gap:10px; color:#8eabb8; font-size:.72rem; } .meta span { padding:3px 7px; border-radius:4px; background:#193a49; color:#a3effb; } h2 { margin-top:9px; font-size:1.15rem; } article p, article a { display:block; margin-top:8px; color:#91adb9; font-size:.8rem; } article a { color:#6edff3; } .empty { padding:48px 24px; border:1px dashed #365869; border-top:0; text-align:center; } .empty p { margin-top:10px; color:#8eabb8; }
	@media (max-width:700px) { .masthead { flex-wrap:wrap; } nav { width:100%; margin:0; overflow-x:auto; } .content { padding:28px 16px; } .heading { align-items:start; flex-direction:column; } article { grid-template-columns:1fr; gap:12px; } }
</style>
